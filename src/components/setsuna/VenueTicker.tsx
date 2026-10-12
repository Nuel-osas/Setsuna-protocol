import { ProtocolLabel } from "./ProtocolIcon";

const venues = ["Aave", "Morpho", "Euler", "Neverland", "Curvance", "Kuru", "Perpl"];

// Two identical groups slide left by half the track, so the loop is seamless.
export default function VenueTicker() {
  return (
    <section className="m-venues" aria-label="Connected lending and trading venues">
      <div className="m-venues-backdrop" aria-hidden="true">
        <i />
      </div>
      <span>Built around Monad’s markets</span>
      <div className="m-ticker">
        <div className="m-ticker-track">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="m-ticker-group"
              aria-hidden={copy === 1 ? true : undefined}
            >
              {venues.map((name) => (
                <ProtocolLabel key={name} name={name} size={30} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p>Protocol integrations · independent venues</p>
    </section>
  );
}
