import { useEffect } from 'react';

/**
 * Dynamic PWA branding: updates document title, favicon, apple-touch-icon,
 * theme-color and manifest link based on the company's booking page.
 *
 * Pass slug (required) and optional (name, logoUrl, themeColor).
 * When logoUrl is provided it takes priority; otherwise we pull manifest from backend.
 */
export function useCompanyBranding({ slug, name, logoUrl, themeColor }) {
  useEffect(() => {
    if (!slug) return;

    const API = process.env.REACT_APP_BACKEND_URL || '';

    // Title
    if (name) {
      document.title = name;
    }

    // Apple Web App Title
    let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!appleTitle) {
      appleTitle = document.createElement('meta');
      appleTitle.name = 'apple-mobile-web-app-title';
      document.head.appendChild(appleTitle);
    }
    if (name) appleTitle.content = name.substring(0, 30);

    // Theme color
    if (themeColor) {
      let themeTag = document.querySelector('meta[name="theme-color"]');
      if (!themeTag) {
        themeTag = document.createElement('meta');
        themeTag.name = 'theme-color';
        document.head.appendChild(themeTag);
      }
      themeTag.content = themeColor;
    }

    // Icons: favicon + apple-touch-icon
    const setOrCreateLink = (rel, href, sizes) => {
      let selector = `link[rel="${rel}"]`;
      if (sizes) selector += `[sizes="${sizes}"]`;
      let link = document.querySelector(selector);
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        if (sizes) link.setAttribute('sizes', sizes);
        document.head.appendChild(link);
      }
      link.href = href;
    };

    if (logoUrl) {
      const absLogoUrl = logoUrl.startsWith('http') ? logoUrl : `${API}${logoUrl}`;
      setOrCreateLink('icon', absLogoUrl);
      setOrCreateLink('apple-touch-icon', absLogoUrl);
      setOrCreateLink('shortcut icon', absLogoUrl);
    }

    // Manifest (dynamic per company)
    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = `${API}/api/public/manifest/${slug}`;
  }, [slug, name, logoUrl, themeColor]);
}
