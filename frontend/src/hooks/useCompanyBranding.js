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

    // Icons: favicon + apple-touch-icon (all variants)
    const updateAllIcons = (href) => {
      const appleIcons = document.querySelectorAll('link[rel="apple-touch-icon"]');
      if (appleIcons.length === 0) {
        // Ensure at least one apple-touch-icon exists
        ['152x152', '167x167', '180x180'].forEach((sz) => {
          const l = document.createElement('link');
          l.rel = 'apple-touch-icon';
          l.setAttribute('sizes', sz);
          l.href = href;
          document.head.appendChild(l);
        });
      } else {
        appleIcons.forEach((l) => { l.href = href; });
      }
      let shortcut = document.querySelector('link[rel="shortcut icon"]');
      if (!shortcut) {
        shortcut = document.createElement('link');
        shortcut.rel = 'shortcut icon';
        document.head.appendChild(shortcut);
      }
      shortcut.href = href;
      let favicon = document.querySelector('link[rel="icon"]');
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      favicon.href = href;
    };

    if (logoUrl) {
      const absLogoUrl = logoUrl.startsWith('http') ? logoUrl : `${API}${logoUrl}`;
      updateAllIcons(absLogoUrl);
    }

    // Manifest (dynamic per company) - prefer same-origin relative URL to avoid CORS
    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.setAttribute('crossorigin', 'use-credentials');
    manifestLink.href = `/api/public/manifest/${slug}`;
  }, [slug, name, logoUrl, themeColor]);
}
