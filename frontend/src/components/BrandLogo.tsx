type BrandLogoProps = {
  dark?: boolean;
  onClick?: () => void;
  className?: string;
};

export function BrandLogo({ dark = false, onClick, className = "" }: BrandLogoProps) {
  return (
    <button
      aria-label="Ir para o início do Evento360"
      className={`brand ${dark ? "brand-dark" : ""} ${className}`.trim()}
      onClick={onClick}
      type="button"
    >
      <img alt="" className="brand-mark" src="/assets/evento360-logo.png" />
      <span className="brand-wordmark">
        Evento<span>360</span>
      </span>
    </button>
  );
}
