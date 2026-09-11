/**
 * Icon — renders a glyph from the gridZERO icon set as an inline SVG.
 *
 * Icons inherit the surrounding text colour via `stroke="currentColor"`,
 * so they tint with Tailwind text-* classes.
 *
 *   <Icon name="drone" />
 *   <Icon name="battery" size={20} />
 *   <Icon name="alert-triangle" className="text-amber-500" />
 *
 * Path geometry and the Leaflet-friendly `iconMarkup()` helper live in
 * ./icons.js so this module only exports a component (keeps Fast Refresh happy).
 */

import { PATHS } from "./icons";

export default function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className = "",
  title,
  ...rest
}) {
  const body = PATHS[name];
  if (!body) {
    if (import.meta.env.DEV) console.warn(`<Icon>: unknown icon name "${name}"`);
    return null;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: title ? `<title>${title}</title>${body}` : body }}
      {...rest}
    />
  );
}
