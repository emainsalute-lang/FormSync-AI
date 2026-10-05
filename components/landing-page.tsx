import Link from "next/link";
import {
  ArrowRight,
  Check,
  Play,
  ScanLine,
  TrendingUp,
  Dumbbell,
} from "lucide-react";

export function ProgressPreview() {
  return (
    <div className="marketing-chart">
      <div className="marketing-chart-title">
        <span>Practice progress</span>
        <span>Example data</span>
      </div>
      <strong>Small steps. Visible progress.</strong>
      <svg
        viewBox="0 0 420 170"
        role="img"
        aria-label="Illustrative practice progress increasing over six weeks"
      >
        <defs>
          <linearGradient id="progress-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#92c853" stopOpacity=".35" />
            <stop offset="1" stopColor="#92c853" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[35, 75, 115, 155].map((y) => (
          <path key={y} d={`M10 ${y}H410`} stroke="#e2e8df" />
        ))}
        <path
          d="M10 140L90 115L170 125L250 75L330 60L410 20V165H10Z"
          fill="url(#progress-fill)"
        />
        <path
          d="M10 140L90 115L170 125L250 75L330 60L410 20"
          fill="none"
          stroke="#25753c"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        {[
          [10, 140],
          [90, 115],
          [170, 125],
          [250, 75],
          [330, 60],
          [410, 20],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="5" fill="#25753c" />
        ))}
      </svg>
      <div className="marketing-chart-weeks">
        <span>Week 1</span>
        <span>Week 3</span>
        <span>Week 6</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <Link href="/" className="marketing-brand">
          <img src="/brand/logo-black.png" alt="" />
          FormSync<span>AI</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div>
          <Link href="/auth?next=%2F" className="marketing-login">
            Sign in
          </Link>
          <Link href="/auth?mode=signup&next=%2F" className="marketing-button">
            Create account <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <section className="marketing-hero">
        <div>
          <p className="marketing-kicker">YOUR PERSONAL TRAINING LAB</p>
          <h1>
            See your form.
            <br />
            Find your <em>edge.</em>
          </h1>
          <p className="marketing-lead">
            Turn practice into progress. Review your videos, track every rep,
            and build a clearer picture of how you train.
          </p>
          <div className="marketing-actions">
            <Link
              href="/auth?mode=signup&next=%2F"
              className="marketing-button"
            >
              Start your training journey <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className="marketing-secondary">
              <Play size={16} /> Explore the app
            </a>
          </div>
          <p className="marketing-small">
            Your videos. Your notes. Your private workspace.
          </p>
        </div>
        <div className="marketing-preview">
          <div className="marketing-preview-top">
            <span>FORMSYNC / VIDEO REVIEW</span>
            <span className="marketing-live">Practice session</span>
          </div>
          <div className="marketing-court">
            <svg
              viewBox="0 0 440 260"
              role="img"
              aria-label="Illustration of an athlete reviewing shooting form on a basketball court"
            >
              <path
                d="M0 220H440M80 220L170 120H330L420 220M200 220V180Q250 130 300 180V220"
                stroke="#8da58a"
                fill="none"
              />
              <path
                d="M340 45V180M310 45H370M325 68H355"
                stroke="#d4e5c6"
                strokeWidth="5"
              />
              <circle cx="236" cy="68" r="16" fill="#e2eacb" />
              <path
                d="M230 87L215 139L189 194M215 139L257 194M229 94L258 63L277 39M225 99L250 76L269 49"
                stroke="#c3eb84"
                strokeWidth="13"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="286" cy="30" r="13" fill="#e5a761" />
              <path
                d="M216 137L230 91L257 65"
                stroke="white"
                strokeWidth="2"
                fill="none"
                strokeDasharray="4 4"
              />
              <circle cx="230" cy="91" r="5" fill="white" />
              <path d="M228 111Q244 109 245 96" stroke="white" fill="none" />
              <text x="256" y="113" fill="white" fontSize="13">
                Angle tool
              </text>
            </svg>
            <span className="marketing-video-label">
              <ScanLine size={15} /> Review one frame at a time
            </span>
          </div>
          <div className="marketing-timeline">
            <Play size={14} />
            <span />
            <small>00:08 / 00:24</small>
          </div>
          <div className="marketing-example">Illustrative product preview</div>
          <ProgressPreview />
        </div>
      </section>
      <section id="features" className="marketing-features">
        {[
          {
            icon: ScanLine,
            title: "Look closer at your form",
            text: "Slow down a clip, draw on individual frames, and measure angles to understand your movement.",
          },
          {
            icon: Dumbbell,
            title: "Give every session a story",
            text: "Log makes, misses, reps, effort, and personal notes alongside your practice videos.",
          },
          {
            icon: TrendingUp,
            title: "Keep your progress in view",
            text: "Revisit saved sessions and organize your workouts in one training workspace.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon size={25} />
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section id="how-it-works" className="marketing-detail">
        <div className="marketing-phone">
          <div className="marketing-phone-head">
            Your training workspace<span>SESSION PREVIEW</span>
          </div>
          <h3>Shooting practice</h3>
          <div className="marketing-reps">
            <strong>
              24<span>reps logged</span>
            </strong>
            <strong>
              18<span>makes</span>
            </strong>
          </div>
          <ProgressPreview />
          <div className="marketing-note">
            <Check size={18} />
            <span>
              Keep your follow-through consistent.
              <small>Personal session note</small>
            </span>
          </div>
        </div>
        <div>
          <p className="marketing-kicker">A LITTLE BETTER, EVERY SESSION</p>
          <h2>
            More intention.
            <br />
            Less guesswork.
          </h2>
          <p>
            Bring your practice footage and your training log together. Know
            what you worked on, what you noticed, and what to focus on next.
          </p>
          <ol className="marketing-steps">
            <li>
              <b>01</b>
              <span>
                <strong>Upload or record</strong>Bring a practice video into
                your workspace.
              </span>
            </li>
            <li>
              <b>02</b>
              <span>
                <strong>Review the details</strong>Slow it down, annotate
                frames, and add your notes.
              </span>
            </li>
            <li>
              <b>03</b>
              <span>
                <strong>Save and build on it</strong>Log your session and return
                to it as you improve.
              </span>
            </li>
          </ol>
        </div>
      </section>
      <section className="marketing-cta">
        <p className="marketing-kicker">THE WORK ADDS UP</p>
        <h2>Your next rep starts here.</h2>
        <p>Make room for a more thoughtful way to train.</p>
        <Link href="/auth?mode=signup&next=%2F" className="marketing-button">
          Create your account <ArrowRight size={18} />
        </Link>
      </section>
      <footer className="marketing-footer">
        <Link href="/" className="marketing-brand">
          FormSync<span>AI</span>
        </Link>
        <span>Small adjustments. Lasting progress.</span>
        <Link href="/auth?next=%2F">
          Sign in <ArrowRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
