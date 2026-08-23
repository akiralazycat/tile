export function HouseBar({ product }: { product: string }) {
  return (
    <nav className="house-bar" aria-label="Manabeakira apps">
      <a href="https://app.manabeakira.com" aria-label="Open Manabeakira apps">
        <span className="house-bar__mark" aria-hidden="true" />
        <span>manabeakira / apps</span>
      </a>
      <span className="house-bar__product">{product}</span>
    </nav>
  );
}
