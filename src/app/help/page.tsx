'use client';

import { useState } from "react";
import { PageHeader } from "@/components/design-system/Primitives";
import { helpArticles, searchHelpArticles } from "@/lib/support/support-content";

export default function HelpPage() {
  const [query, setQuery] = useState("");
  const articles = searchHelpArticles(query);
  return <section aria-labelledby="help-title"><PageHeader eyebrow="SUPPORT" title="Help"><p id="help-title" className="lede">Search practical guidance for the read-only research viewer, its data limits, and its browser-local tools.</p></PageHeader><label className="search-label" htmlFor="help-search">Search help <input id="help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter, export, barcode, provenance…" /></label><p role="status" className="muted">{articles.length} {articles.length === 1 ? "topic" : "topics"} found</p><div className="support-list">{articles.map((article) => <article key={article.id} className="support-card"><h2>{article.title}</h2><p>{article.body}</p></article>)}</div>{articles.length === 0 && <p className="empty-state">No help topic matches that search. Try a route name or a term such as export, plate, or snapshot.</p>}</section>;
}

export { helpArticles, searchHelpArticles } from "@/lib/support/support-content";
