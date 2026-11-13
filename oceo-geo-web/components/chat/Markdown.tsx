"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Styled to match the chat bubble's serif prose. Raw HTML in model output is
// not rendered (react-markdown escapes it by default).
const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[#1A1F26]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-3 last:mb-0 ml-5 list-disc space-y-1 marker:text-[#A0AAB4]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 last:mb-0 ml-5 list-decimal space-y-1 marker:text-[#A0AAB4]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  h1: ({ children }) => (
    <h3 className="mt-4 mb-2 first:mt-0 text-[17px] font-semibold text-[#1A1F26]">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-2 first:mt-0 text-[16px] font-semibold text-[#1A1F26]">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 mb-1.5 first:mt-0 text-[15px] font-semibold text-[#1A1F26]">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 first:mt-0 text-[15px] font-semibold text-[#1A1F26]">{children}</h4>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#4A87BE] underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-[#DDE1E6] pl-4 text-[#5A6A7A]">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-[#DDE1E6]" />,
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} font-mono text-[12px]`}>{children}</code>
    ) : (
      <code className="font-mono text-[13px] bg-[#F0F2F4] px-1 py-0.5 rounded-sm">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto bg-[#F8F9FA] border border-[#DDE1E6] rounded-sm p-3 font-mono text-[12px] leading-snug">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto border border-[#DDE1E6] rounded-sm">
      <table className="w-full border-collapse font-sans text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#F0F2F4]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-[#7A8A9A] font-bold border-b border-[#DDE1E6]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-[#3D4A58] border-b border-[#F0F2F4]">{children}</td>
  ),
};

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
