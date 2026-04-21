import { ArrowRight, CalendarCheck2, CheckCheck, MessageCircle, Sparkles, Waypoints } from 'lucide-react';

export const GLOBAL_WHATSAPP_URL =
  'https://api.whatsapp.com/send/?phone=8619917902815&text=Hi%20Coke%2C%20I%27d%20like%20to%20get%20started.';

const PROMISE_CARDS = [
  {
    title: 'Think with you, not just answer you',
    body: 'Use Coke as one steady thread for planning, drafting, coordinating, and remembering what still matters next.',
  },
  {
    title: 'Move from idea to follow-through',
    body: 'Ask for outreach, reminders, light research, trip planning, or meeting coordination without juggling tools.',
  },
  {
    title: 'Stay in one familiar chat',
    body: 'No setup ceremony. No dashboard maze. Just start talking in WhatsApp and keep the thread moving.',
  },
] as const;

const WORKFLOW_STEPS = [
  {
    label: 'Start with a real task',
    title: 'Drop the thing that is on your mind',
    body: 'A meeting to schedule. A trip to plan. A note to send. Coke is designed for live requests, not demo prompts.',
  },
  {
    label: 'Keep the thread alive',
    title: 'Ask follow-up questions without resetting context',
    body: 'The conversation stays warm, so you can refine tone, timing, priorities, and next actions in one place.',
  },
  {
    label: 'Let it close the loop',
    title: 'Use Coke when the next move matters',
    body: 'Turn open loops into sent messages, coordinated plans, reminders, and concrete next steps you can act on.',
  },
] as const;

const CHAT_THREAD = [
  { who: 'user', text: 'Need a clean plan for tomorrow before 10am.' },
  {
    who: 'coke',
    text: "You have space before 9:30. I can line up the morning, draft the follow-up, and remind you before it's time.",
    status: 'Ready',
  },
  { who: 'user', text: 'Do that, and keep the tone calm.' },
  { who: 'coke', text: 'On it. I will keep everything in this thread so you can adjust on the fly.', status: 'Sent' },
] as const;

function WhatsAppButton({ label, className = '' }: { label: string; className?: string }) {
  const resolvedClassName = className ? `global-cta global-cta--primary ${className}` : 'global-cta global-cta--primary';

  return (
    <a href={GLOBAL_WHATSAPP_URL} className={resolvedClassName} target="_blank" rel="noreferrer">
      <span>{label}</span>
      <ArrowRight size={16} aria-hidden="true" />
    </a>
  );
}

export function GlobalHomepage() {
  return (
    <div className="coke-site global-site">
      <header className="global-header">
        <div className="global-header__inner">
          <a href="/global" className="global-brand" aria-label="Coke global">
            <span className="global-brand__wordmark">coke</span>
            <span className="global-brand__dot" aria-hidden="true" />
          </a>

          <nav className="global-nav" aria-label="Global page">
            <a href="#promise" className="global-nav__link">
              Why Coke
            </a>
            <a href="#workflow" className="global-nav__link">
              How it works
            </a>
            <a href="#close" className="global-nav__link">
              Start now
            </a>
          </nav>

          <WhatsAppButton label="Open WhatsApp" />
        </div>
      </header>

      <main>
        <section className="global-hero">
          <div className="global-hero__aurora global-hero__aurora--left" aria-hidden="true" />
          <div className="global-hero__aurora global-hero__aurora--right" aria-hidden="true" />
          <div className="global-hero__inner">
            <div className="global-hero__copy">
              <div className="global-kicker">
                <MessageCircle size={14} aria-hidden="true" />
                <span>Available on WhatsApp</span>
              </div>

              <h1 className="global-hero__title">An AI partner that grows with you</h1>
              <p className="global-hero__lede">One chat to plan, coordinate, and follow through.</p>
              <p className="global-hero__body">
                Coke is built for the moments when you need momentum, not another inbox. Message once, keep the thread
                alive, and use the same conversation for planning, reminders, and next actions.
              </p>

              <div className="global-hero__actions">
                <WhatsAppButton label="Message Coke on WhatsApp" className="global-hero__cta" />
              </div>

              <ul className="global-proof" aria-label="Product promise">
                <li className="global-proof__item">
                  <Sparkles size={14} aria-hidden="true" />
                  <span>Fast first response</span>
                </li>
                <li className="global-proof__item">
                  <Waypoints size={14} aria-hidden="true" />
                  <span>One ongoing thread</span>
                </li>
                <li className="global-proof__item">
                  <CalendarCheck2 size={14} aria-hidden="true" />
                  <span>Built for real follow-through</span>
                </li>
              </ul>
            </div>

            <div className="global-hero__stage" aria-hidden="true">
              <div className="global-stage-card">
                <div className="global-stage-card__top">
                  <div className="global-stage-card__avatar">
                    <MessageCircle size={15} />
                  </div>
                  <div>
                    <div className="global-stage-card__name">Coke on WhatsApp</div>
                    <div className="global-stage-card__meta">online and ready to help</div>
                  </div>
                </div>

                <div className="global-thread">
                  {CHAT_THREAD.map((message, index) => (
                    <div key={index} className={`global-thread__bubble global-thread__bubble--${message.who}`}>
                      <p>{message.text}</p>
                      {message.status ? (
                        <span className="global-thread__status">
                          <CheckCheck size={12} aria-hidden="true" />
                          {message.status}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="global-stage-card__composer">
                  <Sparkles size={14} aria-hidden="true" />
                  <span>Coke is keeping your next move in view.</span>
                </div>
              </div>

              <div className="global-stage-note global-stage-note--upper">
                <span className="global-stage-note__label">steady context</span>
                <p>Keep planning, drafting, and reminders in the same chat instead of starting over.</p>
              </div>

              <div className="global-stage-note global-stage-note--lower">
                <span className="global-stage-note__label">clean conversion</span>
                <p>Open the chat, send the first message, and you are in.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="promise" className="global-section">
          <div className="global-section__head">
            <span className="global-section__eyebrow">Why Coke</span>
            <h2 className="global-section__title">A personal operating rhythm, not a pile of tools</h2>
            <p className="global-section__body">
              The global page keeps the same Coke positioning as the main site, but everything points to one place:
              your WhatsApp conversation.
            </p>
          </div>

          <div className="global-promise-grid">
            {PROMISE_CARDS.map((card) => (
              <article key={card.title} className="global-promise-card">
                <span className="global-promise-card__marker" aria-hidden="true" />
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>

          <div className="global-inline-cta">
            <WhatsAppButton label="Start the conversation" />
          </div>
        </section>

        <section id="workflow" className="global-section global-section--workflow">
          <div className="global-section__head">
            <span className="global-section__eyebrow">How it works</span>
            <h2 className="global-section__title">Simple enough to start in seconds</h2>
          </div>

          <div className="global-workflow">
            {WORKFLOW_STEPS.map((step, index) => (
              <article key={step.title} className="global-workflow__step">
                <div className="global-workflow__index">{String(index + 1).padStart(2, '0')}</div>
                <div className="global-workflow__copy">
                  <p className="global-workflow__label">{step.label}</p>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="close" className="global-close">
          <div className="global-close__inner">
            <div>
              <span className="global-section__eyebrow global-section__eyebrow--light">Open the thread</span>
              <h2 className="global-close__title">Start on WhatsApp and let the conversation compound.</h2>
              <p className="global-close__body">
                There is no extra setup on this path. Open the chat, send a message, and use Coke like a partner who
                stays with the task.
              </p>
            </div>

            <WhatsAppButton label="Open WhatsApp now" className="global-close__cta" />
          </div>
        </section>
      </main>
    </div>
  );
}
