import type { CSSProperties } from "react";
import { experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";

/**
 * The provider's mark (Claude, OpenAI) before a row's model name. BB serves
 * each logo as a one-colour SVG, so it is drawn as a mask filled with the
 * provider's declared tint, or with the line's own colour when it has none.
 * A provider without a logo draws nothing.
 */
export function ProviderLogo({ providerId }: { providerId: string }) {
  const { providers } = useProviders();
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider?.logoUrl) return null;
  const tint = provider.strings?.iconTint;
  const mask = `url("${provider.logoUrl}") center / contain no-repeat`;
  const style = {
    mask,
    WebkitMask: mask,
    "--cs-logo-light": tint?.light,
    "--cs-logo-dark": tint?.dark,
  } as CSSProperties;
  return <span aria-hidden="true" data-provider-logo={providerId} className="cs-provider-logo" style={style} />;
}
