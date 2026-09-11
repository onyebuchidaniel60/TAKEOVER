// Phase 11: per-route document metadata (title, description, robots, Open
// Graph). Every call fully reconciles its tags: values it does not set are
// removed, so navigating from an admin page (noindex) back to the
// marketplace cannot leak the robots tag, and stale slot previews cannot
// linger on other routes.
import { useEffect } from 'react';

export interface PageMeta {
  title: string;
  description?: string;
  /** e.g. "noindex" for admin routes. */
  robots?: string;
  og?: {
    title?: string;
    description?: string;
  };
}

function upsertMetaByName(name: string, content: string): void {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function removeMetaByName(name: string): void {
  document.querySelector(`meta[name="${name}"]`)?.remove();
}

function upsertMetaByProperty(property: string, content: string): void {
  let tag = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('property', property);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function removeMetaByProperty(property: string): void {
  document.querySelector(`meta[property="${property}"]`)?.remove();
}

export function usePageMeta(meta: PageMeta): void {
  const { title, description, robots, og } = meta;
  const ogTitle = og?.title;
  const ogDescription = og?.description;
  useEffect(() => {
    document.title = title;
    if (description) {
      upsertMetaByName('description', description);
    } else {
      removeMetaByName('description');
    }
    if (robots) {
      upsertMetaByName('robots', robots);
    } else {
      removeMetaByName('robots');
    }
    if (ogTitle) {
      upsertMetaByProperty('og:title', ogTitle);
    } else {
      removeMetaByProperty('og:title');
    }
    if (ogDescription) {
      upsertMetaByProperty('og:description', ogDescription);
    } else {
      removeMetaByProperty('og:description');
    }
  }, [title, description, robots, ogTitle, ogDescription]);
}
