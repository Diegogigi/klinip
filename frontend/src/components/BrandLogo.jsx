import React, { useId } from "react";

const BRAND_FLOWER_PATH =
  "M50 17.5c7.18 0 13 5.82 13 13v8.41l7.28-4.2c6.21-3.59 14.15-1.46 17.74 4.75 3.59 6.21 1.46 14.15-4.75 17.74L76 61.4l7.27 4.2c6.21 3.59 8.34 11.53 4.75 17.74-3.59 6.21-11.53 8.34-17.74 4.75L63 83.9v8.4c0 7.19-5.82 13-13 13s-13-5.81-13-13v-8.4l-7.28 4.2c-6.21 3.59-14.15 1.46-17.74-4.75-3.59-6.21-1.46-14.15 4.75-17.74l7.27-4.2-7.27-4.2c-6.21-3.59-8.34-11.53-4.75-17.74 3.59-6.21 11.53-8.34 17.74-4.75l7.28 4.2V30.5c0-7.18 5.82-13 13-13Z";
const SOLID_LOGO_SRC = "/icons/new_logo_k.png?v=20260527";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function BrandMark({
  className = "",
  imgClassName = "",
  variant = "solid",
  alt = "",
}) {
  const gradientId = useId().replace(/:/g, "");
  const frameId = useId().replace(/:/g, "");
  const isSolid = variant === "solid";

  return (
    <span
      className={joinClasses(
        "brand-logo-mark",
        variant === "solid" ? "is-solid" : "is-transparent",
        className
      )}
      aria-hidden={alt ? undefined : "true"}
    >
      {isSolid ? (
        <img
          src={SOLID_LOGO_SRC}
          alt={alt || ""}
          draggable="false"
          decoding="async"
          className={joinClasses("brand-logo-img", "brand-logo-raster", imgClassName)}
        />
      ) : (
        <svg
          viewBox="0 0 100 100"
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          focusable="false"
          className={joinClasses("brand-logo-img", "brand-logo-svg", imgClassName)}
        >
          <defs>
            <linearGradient id={gradientId} x1="14" y1="16" x2="86" y2="84" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4DA3FF" />
              <stop offset="52%" stopColor="#1678F2" />
              <stop offset="100%" stopColor="#0D47F7" />
            </linearGradient>
            <linearGradient id={frameId} x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#4DA3FF" stopOpacity="0.52" />
            </linearGradient>
          </defs>
          <path
            d={BRAND_FLOWER_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="7.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

export default function BrandLogo({
  className = "",
  markClassName = "",
  imgClassName = "",
  nameClassName = "",
  variant = "solid",
  responsive = false,
  showMark = true,
  showName = true,
  name = "Klinip",
}) {
  return (
    <span
      className={joinClasses(
        "brand-wordmark",
        "brand-logo",
        showMark ? "" : "no-mark",
        responsive ? "responsive" : "",
        className
      )}
      aria-label={name}
    >
      {showMark ? (
        <BrandMark
          className={markClassName}
          imgClassName={imgClassName}
          variant={variant}
        />
      ) : null}
      {showName ? (
        <span
          className={joinClasses(
            "brand-wordmark-full",
            "brand-logo-name",
            nameClassName
          )}
        >
          {name}
        </span>
      ) : null}
    </span>
  );
}
