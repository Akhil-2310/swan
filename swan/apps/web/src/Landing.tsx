// SPDX-License-Identifier: Apache-2.0

export default function Landing({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="site">
      <header className="site-header">
        <a className="site-brand" href="#top">
          <span className="site-mark">SW</span>
          swan
        </a>
        <nav className="site-nav" aria-label="Landing">
          <a href="#play-how">How it works</a>
          <a href="#lifecycle">Lifecycle</a>
          <a href="#live">Live rails</a>
          <a href="#care">Care</a>
        </nav>
        <button className="toy solid" onClick={onPlay}>
          hatch a nest
        </button>
      </header>

      <main>
        <section className="hero-block" id="top">
          <div className="hero-copy">
            <p className="kicker">virtual pet · ats collateral · hedera</p>
            <h1>Keep the swan plump. Keep the repo honest.</h1>
            <p>
              Swan is a Tamagotchi for compliant bonds. Stuff a nest, feed the pond, ride a storm, and bring the bird
              home—or watch a KYC sale reclaim it.
            </p>
            <div className="hero-actions">
              <button className="toy solid" onClick={onPlay}>
                play the nest
              </button>
              <a className="toy" href="#play-how">
                see the ritual
              </a>
            </div>
            <ul className="hero-facts">
              <li>ATS eligibility</li>
              <li>native test USDC</li>
              <li>signed oracle</li>
              <li>atomic DvP</li>
            </ul>
          </div>
          <div className="hero-toy" aria-hidden>
            <div className="mini-device">
              <div className="mini-bead">SWAN</div>
              <div className="mini-lcd">
                <span className="mini-chip">EGG</span>
                <div className="mini-egg" />
                <div className="mini-water" />
                <p>an egg is waiting</p>
                <div className="mini-hearts">♥ ♥ ♥ ♥</div>
              </div>
              <div className="mini-pads">
                <i />
                <i className="mid" />
                <i />
              </div>
            </div>
          </div>
        </section>

        <section className="band" id="play-how">
          <div className="band-head">
            <p className="kicker">how it works</p>
            <h2>Three buttons. A whole desk.</h2>
          </div>
          <div className="card-grid three">
            <article className="site-card">
              <b>A</b>
              <h3>Pick a menu</h3>
              <p>Nest, bonds, pond, care, sale, and book sit on the LCD like a pocket pet.</p>
            </article>
            <article className="site-card">
              <b>B</b>
              <h3>Do the thing</h3>
              <p>Lock collateral, accept a feed, schedule a coupon snack, or close the repo.</p>
            </article>
            <article className="site-card">
              <b>C</b>
              <h3>Watch the bird</h3>
              <p>Cover, feed, and joy hearts tell you if Swan is healthy, hungry, or in a storm.</p>
            </article>
          </div>
        </section>

        <section className="band" id="lifecycle">
          <div className="band-head">
            <p className="kicker">lifecycle</p>
            <h2>From egg to home—or sale.</h2>
          </div>
          <ol className="life-cards">
            <li>
              <span>01</span>
              <h3>Stuff the nest</h3>
              <p>
                Pick ATS series with haircuts, coupons, and concentration limits. Smallest valid basket scores best.
              </p>
            </li>
            <li>
              <span>02</span>
              <h3>Feed the pond</h3>
              <p>Eligible lenders race on repo rate. No KYC, no feed. Lowest valid rate wins.</p>
            </li>
            <li>
              <span>03</span>
              <h3>Swim</h3>
              <p>Cash lands, the basket locks, and Swan glides while oracles keep pricing the nest.</p>
            </li>
            <li>
              <span>04</span>
              <h3>Care</h3>
              <p>A shock can sicken coverage. Cure with extra units, a swap, or a partial repay—before the clock.</p>
            </li>
            <li>
              <span>05</span>
              <h3>Home or sale</h3>
              <p>
                Pay principal and return, then Swan comes home. Miss the cure and a KYC auction pays the lender first.
              </p>
            </li>
          </ol>
        </section>

        <section className="band split" id="care">
          <div>
            <p className="kicker">care meters</p>
            <h2>Finance, translated into hearts.</h2>
            <p>
              The toy is cute on purpose. Under the LCD, Swan is still a repo: borrowing capacity after haircuts,
              maintenance coverage, and a funded reverse auction.
            </p>
          </div>
          <div className="meter-cards">
            <div>
              <small>cover</small>
              <strong>♥ ♥ ♥ ♥</strong>
              <p>Post-haircut coverage versus the maintenance floor.</p>
            </div>
            <div>
              <small>feed</small>
              <strong>♥ ♥ ♥ ·</strong>
              <p>Capacity versus the $1.00m cash need.</p>
            </div>
            <div>
              <small>joy</small>
              <strong>♥ ♥ · ·</strong>
              <p>Valid offers, a clean close, or a quiet pond.</p>
            </div>
          </div>
        </section>

        <section className="band" id="live">
          <div className="band-head">
            <p className="kicker">live rails</p>
            <h2>Same rules on Hedera testnet.</h2>
          </div>
          <div className="card-grid four">
            <article className="site-card">
              <h3>ATS bonds</h3>
              <p>Eligibility, freeze, pause, and concentration checks sit in front of every nest.</p>
            </article>
            <article className="site-card">
              <h3>Native USDC</h3>
              <p>Cash is Circle’s Hedera test token, six decimals, token id 0.0.429274.</p>
            </article>
            <article className="site-card">
              <h3>Signed oracle</h3>
              <p>Prices are signer-authorized, nonce-protected, and replay-resistant.</p>
            </article>
            <article className="site-card">
              <h3>Atomic DvP</h3>
              <p>Repo open, close, and recovery sale settle security-for-cash in one move.</p>
            </article>
          </div>
        </section>

        <section className="cta-band">
          <h2>Hatch SWAN-1042.</h2>
          <p>Chick, swan, or elder. One egg. A million dollars of pretend cash. Real clocks.</p>
          <button className="toy solid" onClick={onPlay}>
            enter the handheld
          </button>
        </section>
      </main>

      <footer className="site-footer">
        <span className="site-brand">
          <span className="site-mark">SW</span>
          swan
        </span>
        <p>Virtual pet for compliant collateral. Hedera · ATS · testnet USDC.</p>
        <nav>
          <a href="#play-how">How</a>
          <a href="#lifecycle">Lifecycle</a>
          <a href="#live">Live</a>
          <button type="button" onClick={onPlay}>
            Play
          </button>
        </nav>
      </footer>
    </div>
  );
}
