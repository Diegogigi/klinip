import React from "react";

const BRAND_ASSET_VERSION = "20260523a";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function BrandMark({
  className = "",
  imgClassName = "",
  variant = "solid",
  alt = "",
}) {
  const src =
    variant === "solid"
      ? `/icons/new_logo_k_sf.png?v=${BRAND_ASSET_VERSION}`
      : `/icons/new_logo_k.png?v=${BRAND_ASSET_VERSION}`;

  return (
    <span
      className={joinClasses(
        "brand-logo-mark",
        variant === "solid" ? "is-solid" : "is-transparent",
        className
      )}
      aria-hidden={alt ? undefined : "true"}
    >
      <img
        src={src}
        alt={alt}
        className={joinClasses("brand-logo-img", imgClassName)}
      />
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
  showName = true,
  name = "Klinip",
}) {
  return (
    <span
      className={joinClasses(
        "brand-wordmark",
        "brand-logo",
        responsive ? "responsive" : "",
        className
      )}
      aria-label={name}
    >
      <BrandMark
        className={markClassName}
        imgClassName={imgClassName}
        variant={variant}
      />
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
