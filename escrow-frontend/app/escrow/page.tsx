"use client";

import { useEffect, useState } from "react";
import { formatEther, isAddress, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { connect } from "../../lib/wallet";
import { escrowAbi, escrowBytecode } from "../../lib/escrow";
import { api, type EscrowDetails, type OpenJob, type SubmitResult } from "../../lib/api";
import { EXPLORER_TX, SETTLEMENT_GRACE_SECONDS } from "../../lib/config";

type Session = Awaited<ReturnType<typeof connect>>;
type Tab = "create" | "jobs" | "submit" | "track";
type StepState = "pending" | "active" | "done" | "error";

const errMsg = (e: unknown) => {
  const x = e as { shortMessage?: string; message?: string };
  return x.shortMessage ?? x.message ?? "Something went wrong.";
};

const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function TxLink({ hash }: { hash: string }) {
  if (!hash) return null;
  return EXPLORER_TX ? (
    <a href={EXPLORER_TX + hash} target="_blank" rel="noreferrer">
      <code>{short(hash)}</code>
    </a>
  ) : (
    <code>{short(hash)}</code>
  );
}

export default function EscrowPage() {
  const [tab, setTab] = useState<Tab>("create");
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");

  // Shared "which contract am I looking at" value, filled from ?job=0x... or by clicking a job.
  const [target, setTarget] = useState("");

  useEffect(() => {
    const job = new URLSearchParams(window.location.search).get("job");
    if (job && isAddress(job)) {
      setTarget(job);
      setTab("track");
    }
  }, []);

  async function onConnect() {
    setConnecting(true);
    setWalletError("");
    try {
      setSession(await connect());
    } catch (e) {
      setWalletError(errMsg(e));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main>
      <div className="card">
        {session ? (
          <p style={{ margin: 0 }}>
            Connected as <code>{session.account}</code>
          </p>
        ) : (
          <>
            <button type="button" style={{ marginTop: 0 }} onClick={onConnect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect MetaMask"}
            </button>
            {walletError && <p className="error">{walletError}</p>}
          </>
        )}
      </div>

      <div className="tabs">
        {(
          [
            ["create", "Create"],
            ["jobs", "Open jobs"],
            ["submit", "Submit work"],
            ["track", "Track"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <CreateTab
          session={session}
          onCreated={(addr) => {
            setTarget(addr);
          }}
          onTrack={(addr) => {
            setTarget(addr);
            setTab("track");
          }}
        />
      )}
      {tab === "jobs" && (
        <JobsTab
          session={session}
          onOpen={(addr) => {
            setTarget(addr);
            setTab("track");
          }}
        />
      )}
      {tab === "submit" && <SubmitTab session={session} initialAddress={target} />}
      {tab === "track" && <TrackTab session={session} address={target} setAddress={setTarget} />}
    </main>
  );
}

/* ───────────────────────── Create ───────────────────────── */

function CreateTab({
  session,
  onCreated,
  onTrack,
}: {
  session: Session | null;
  onCreated: (addr: string) => void;
  onTrack: (addr: string) => void;
}) {
  const [requirement, setRequirement] = useState("");
  const [price, setPrice] = useState("0.01");
  const [minutes, setMinutes] = useState("60");
  const [revisions, setRevisions] = useState("2");
  const [freelancer, setFreelancer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<[string, StepState][]>([]);
  const [created, setCreated] = useState("");

  function mark(i: number, state: StepState) {
    setSteps((s) => s.map(([l, st], idx) => (idx === i ? [l, state] : [l, st])));
  }

  async function onSubmit() {
    if (!session) return setError("Connect your wallet first.");
    setError("");
    setCreated("");

    let amount: bigint;
    try {
      amount = parseEther(price);
    } catch {
      return setError("Enter a valid price in ETH.");
    }
    if (amount <= 0n) return setError("Price must be greater than zero.");
    if (requirement.trim().length < 10) return setError("Describe the requirement in a little more detail.");
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return setError("Deadline must be a positive number of minutes.");
    const rev = Number(revisions);
    if (!Number.isInteger(rev) || rev < 0) return setError("Revisions must be a whole number, 0 or more.");
    const fl = freelancer.trim();
    if (fl && !isAddress(fl)) return setError("Freelancer address is not valid. Leave it empty for an open job.");

    setBusy(true);
    setSteps([
      ["Read the AI oracle address from the backend", "active"],
      ["Deploy the escrow contract", "pending"],
      ["Lock the funds in the contract", "pending"],
      ["Register the job with the backend", "pending"],
    ]);

    let stage = 0;
    try {
      const { oracle } = await api.health();
      mark(0, "done");

      stage = 1;
      mark(1, "active");
      const block = await session.publicClient.getBlock();
      const deadline = block.timestamp + BigInt(Math.round(mins * 60));
      const deployHash = await session.walletClient.deployContract({
        abi: escrowAbi,
        bytecode: escrowBytecode,
        account: session.account,
        args: [session.account, (fl || zeroAddress) as Address, oracle as Address, amount, deadline, rev],
      });
      const receipt = await session.publicClient.waitForTransactionReceipt({ hash: deployHash });
      const address = receipt.contractAddress;
      if (!address) throw new Error("Deployment finished but no contract address was returned.");
      mark(1, "done");

      stage = 2;
      mark(2, "active");
      const depositHash = await session.walletClient.writeContract({
        address,
        abi: escrowAbi,
        functionName: "deposit",
        account: session.account,
        value: amount,
      });
      await session.publicClient.waitForTransactionReceipt({ hash: depositHash });
      mark(2, "done");

      stage = 3;
      mark(3, "active");
      await api.register(address, requirement.trim());
      mark(3, "done");

      setCreated(address);
      onCreated(address);
    } catch (e) {
      mark(stage, "error");
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const link =
    created && typeof window !== "undefined" ? `${window.location.origin}/escrow?job=${created}` : "";

  return (
    <div className="card">
      <h2>Create an escrow</h2>

      <label htmlFor="req">What should be delivered?</label>
      <textarea
        id="req"
        rows={6}
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        placeholder="Be specific. The AI judges the delivery against exactly this text."
      />

      <label htmlFor="price">Price (ETH)</label>
      <input id="price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />

      <label htmlFor="mins">Deadline (minutes from now)</label>
      <input id="mins" value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" />

      <label htmlFor="rev">Revisions allowed</label>
      <input id="rev" value={revisions} onChange={(e) => setRevisions(e.target.value)} inputMode="numeric" />

      <label htmlFor="fl">Freelancer address (optional)</label>
      <input
        id="fl"
        value={freelancer}
        onChange={(e) => setFreelancer(e.target.value)}
        placeholder="Leave empty to post an open job anyone can accept"
      />

      <button type="button" onClick={onSubmit} disabled={busy}>
        {busy ? "Working…" : "Create and fund escrow"}
      </button>

      {steps.length > 0 && (
        <ul className="steps">
          {steps.map(([label, st]) => (
            <li key={label} className={`step ${st === "pending" ? "" : st}`}>
              <span className="icon">{st === "done" ? "✓" : st === "error" ? "✕" : st === "active" ? "…" : "·"}</span>
              {label}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {created && (
        <div className="result ok">
          <strong>Escrow created and funded.</strong>
          <p>
            Contract: <code className="wrap">{created}</code>
          </p>
          {link && (
            <p>
              Share this link with the freelancer: <code className="wrap">{link}</code>
            </p>
          )}
          <button type="button" className="ghost" style={{ marginTop: 12 }} onClick={() => onTrack(created)}>
            Track it
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Open jobs ───────────────────────── */

function JobsTab({ session, onOpen }: { session: Session | null; onOpen: (addr: string) => void }) {
  const [jobs, setJobs] = useState<OpenJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setJobs((await api.openJobs()).jobs ?? []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function accept(addr: string) {
    if (!session) return setError("Connect your wallet first.");
    setError("");
    setAccepting(addr);
    try {
      const hash = await session.walletClient.writeContract({
        address: addr as Address,
        abi: escrowAbi,
        functionName: "acceptJob",
        account: session.account,
      });
      await session.publicClient.waitForTransactionReceipt({ hash });
      onOpen(addr);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setAccepting("");
    }
  }

  return (
    <div className="card">
      <h2>Open jobs</h2>
      <button type="button" className="ghost" style={{ marginTop: 0 }} onClick={load} disabled={loading}>
        {loading ? "Loading…" : "Refresh"}
      </button>
      {error && <p className="error">{error}</p>}
      {jobs && jobs.length === 0 && <p className="muted">No open jobs right now.</p>}
      {jobs?.map((j) => (
        <div className="job" key={j.contract_address}>
          <div className="job-head">
            <strong>{formatEther(BigInt(j.amount_wei))} ETH</strong>
            <span className="muted small">
              Due {new Date(j.deadline * 1000).toLocaleString()} · {j.revision_limit} revision
              {j.revision_limit === 1 ? "" : "s"}
            </span>
          </div>
          <p className="job-req">{j.requirement}</p>
          <p className="muted small">
            Client <code>{short(j.client_address)}</code> · Contract <code>{short(j.contract_address)}</code>
          </p>
          <div className="row">
            <button type="button" onClick={() => accept(j.contract_address)} disabled={!!accepting}>
              {accepting === j.contract_address ? "Accepting…" : "Accept this job"}
            </button>
            <button type="button" className="ghost" style={{ marginTop: 16 }} onClick={() => onOpen(j.contract_address)}>
              Details
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Submit work ───────────────────────── */

function SubmitTab({ session, initialAddress }: { session: Session | null; initialAddress: string }) {
  const [address, setAddress] = useState(initialAddress);
  const [mode, setMode] = useState<"link" | "text">("link");
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  async function onSubmit() {
    if (!session) return setError("Connect your wallet first.");
    if (!isAddress(address.trim())) return setError("Enter a valid contract address.");
    if (mode === "link" && !link.trim()) return setError("Paste a link to your work.");
    if (mode === "text" && !text.trim()) return setError("Paste your work into the box.");
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const body =
        mode === "link"
          ? { freelancer: session.account, submission_link: link.trim() }
          : { freelancer: session.account, submission_text: text };
      setResult(await api.submit(address.trim(), body));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Submit your work</h2>
      <label htmlFor="sub-addr">Contract address</label>
      <input id="sub-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />

      <div className="toggle">
        <button type="button" className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>
          Link
        </button>
        <button type="button" className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>
          Paste code or text
        </button>
      </div>

      {mode === "link" ? (
        <>
          <label htmlFor="sub-link">Link to your work</label>
          <input id="sub-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </>
      ) : (
        <>
          <label htmlFor="sub-text">Your work</label>
          <textarea id="sub-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}

      <button type="button" onClick={onSubmit} disabled={busy}>
        {busy ? "Submitting…" : "Submit for AI review"}
      </button>

      {busy && (
        <div className="processing">
          <span className="spinner" />
          <span>The AI is reviewing your work. This can take a minute.</span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <div className={`result ${result.decision ? "ok" : "bad"}`}>
          <strong>
            {result.status === "released"
              ? "Approved. Funds released to you."
              : result.status === "refunded"
                ? "Rejected. Funds refunded to the client."
                : "Revision requested. You can submit again."}
          </strong>
          <p>{result.reasoning}</p>
          <p className="muted small">
            Revisions used: {result.revisions_used} of {result.revision_limit}
            {result.tx_hash && (
              <>
                {" "}
                · Transaction <TxLink hash={result.tx_hash} />
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Track ───────────────────────── */

function TrackTab({
  session,
  address,
  setAddress,
}: {
  session: Session | null;
  address: string;
  setAddress: (a: string) => void;
}) {
  const [data, setData] = useState<EscrowDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");

  async function load(addr = address) {
    const a = addr.trim();
    if (!isAddress(a)) return setError("Enter a valid contract address.");
    setLoading(true);
    setError("");
    try {
      setData(await api.get(a));
    } catch (e) {
      setData(null);
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-load when we arrive with an address (from a link or the jobs list), then poll while it is open.
  useEffect(() => {
    if (address && isAddress(address.trim())) load(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data) return;
    const s = data.chain_status ?? data.escrow.status;
    if (s === "released" || s === "refunded") return;
    const t = setInterval(() => load(address), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, address]);

  async function send(fn: "acceptJob" | "refundAfterDeadline") {
    if (!session) return setError("Connect your wallet first.");
    setError("");
    setActing(fn);
    try {
      const hash = await session.walletClient.writeContract({
        address: address.trim() as Address,
        abi: escrowAbi,
        functionName: fn,
        account: session.account,
      });
      await session.publicClient.waitForTransactionReceipt({ hash: hash as Hex });
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setActing("");
    }
  }

  const e = data?.escrow;
  const status = data?.chain_status ?? e?.status ?? "";
  const nowSec = Math.floor(Date.now() / 1000);
  const deadline = data?.chain_deadline ?? (e ? Math.floor(new Date(e.deadline_at).getTime() / 1000) : 0);
  const canRefund = status === "funded" && deadline > 0 && nowSec > deadline + SETTLEMENT_GRACE_SECONDS;
  const isOpen = status === "funded" && data?.chain_freelancer === "";

  return (
    <div className="card">
      <h2>Track an escrow</h2>
      <div className="row">
        <input value={address} onChange={(ev) => setAddress(ev.target.value)} placeholder="Contract address 0x…" />
        <button type="button" style={{ marginTop: 0 }} onClick={() => load()} disabled={loading}>
          {loading ? "Loading…" : "Look up"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {e && (
        <>
          <dl>
            <dt>Status</dt>
            <dd>
              <span className={`pill ${status}`}>{status || "unknown"}</span>
              {loading && <span className="spinner small" />}
            </dd>
            <dt>Amount</dt>
            <dd>{data?.chain_amount_wei ? `${formatEther(BigInt(data.chain_amount_wei))} ETH` : "—"}</dd>
            <dt>Client</dt>
            <dd>
              <code>{e.client_address}</code>
            </dd>
            <dt>Freelancer</dt>
            <dd>{data?.chain_freelancer ? <code>{data.chain_freelancer}</code> : "Open: nobody has accepted yet"}</dd>
            <dt>Deadline</dt>
            <dd>{deadline ? new Date(deadline * 1000).toLocaleString() : "—"}</dd>
            <dt>Revisions</dt>
            <dd>
              {data?.chain_revisions_used ?? e.revisions_used} of {data?.chain_revision_limit ?? e.revision_limit} used
            </dd>
            <dt>Requirement</dt>
            <dd className="job-req">{e.initial_prompt}</dd>
            {e.submission_link && (
              <>
                <dt>Submission</dt>
                <dd>{e.submission_link}</dd>
              </>
            )}
          </dl>

          {e.ai_decision !== null && e.ai_reasoning && (
            <div className={`result ${e.ai_decision ? "ok" : "bad"}`}>
              <strong>AI verdict: {e.ai_decision ? "approved" : "not approved"}</strong>
              <p>{e.ai_reasoning}</p>
              {e.tx_hash && (
                <p className="muted small">
                  Transaction <TxLink hash={e.tx_hash} />
                </p>
              )}
            </div>
          )}

          {e.last_error && <p className="error">Backend note: {e.last_error}</p>}

          {isOpen && (
            <button type="button" onClick={() => send("acceptJob")} disabled={!!acting}>
              {acting === "acceptJob" ? "Accepting…" : "Accept this job"}
            </button>
          )}

          {canRefund && (
            <button type="button" className="ghost" onClick={() => send("refundAfterDeadline")} disabled={!!acting}>
              {acting === "refundAfterDeadline" ? "Refunding…" : "Refund the client (deadline passed)"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
