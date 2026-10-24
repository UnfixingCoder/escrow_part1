import Reveal from "./Reveal";

const QA = [
  {
    q: "Who can take a job?",
    a: "The client either names one freelancer wallet or opens the job to anyone. On an open job, the first wallet to accept it is the only one who can submit work and be paid. The client cannot accept their own job.",
  },
  {
    q: "How does the AI decide?",
    a: "It reads the freelancer's submission and compares it with the requirement the client wrote. If the work passes, the funds are released. If not, the freelancer can revise until the revision limit is used up, then the client is refunded.",
  },
  {
    q: "What if the work never arrives?",
    a: "Once the deadline and a 10-minute grace period have passed with no verdict, anyone can send the refund transaction. The contract only ever pays the client.",
  },
  {
    q: "Is real money involved?",
    a: "Not right now. The project runs on a test network, so the ETH has no real value.",
  },
];

export default function Faq() {
  return (
    <section className="faq" id="faq">
      <Reveal>
        <p className="section-tag">[02] Questions</p>
        <h2>
          Good to know <em>first.</em>
        </h2>
      </Reveal>
      <div className="faq-list">
        {QA.map((item, i) => (
          <Reveal key={item.q} delay={i * 0.08}>
            <details>
              <summary>
                <b>{String(i + 1).padStart(2, "0")}</b>
                {item.q}
              </summary>
              <p>{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
