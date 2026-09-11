import { useLogoSrc } from "@/hooks/use-logo-src";

interface LogoImgProps {
  className?: string;
  alt?: string;
}

export function LogoImg({ className, alt = "Logo" }: LogoImgProps) {
  const src = useLogoSrc();
  return <img src={src} alt={alt} className={className} />;
}
