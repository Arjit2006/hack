import React from 'react';
import ReactMarkdown from 'react-markdown';

interface FormattedMarkdownProps {
  content: string;
  className?: string;
}

export const FormattedMarkdown: React.FC<FormattedMarkdownProps> = ({ content, className = '' }) => {
  return (
    <div className={`prose prose-sm max-w-none text-slate-800 leading-relaxed space-y-2 [&>p]:m-0 [&>ul]:pl-5 [&>ol]:pl-5 [&>li]:m-0 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-xs [&>strong]:font-semibold ${className}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
};
