import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { marked } from 'marked'

const projectRoot = path.resolve('.')

// List of docs to compile in logical presentation order
const docFiles = [
  {
    title: 'Executive Summary & Product Requirements (PRD)',
    path: path.join(projectRoot, 'PRD.md'),
  },
  {
    title: 'Architecture Essentials (Quick Reference)',
    path: path.join(projectRoot, 'ARCHITECTURE-ESSENTIALS.md'),
  },
  {
    title: 'Complete Technical Architecture & Specifications',
    path: path.join(projectRoot, 'ARCHITECTURE.md'),
  },
  {
    title: 'Development Principles & Invariants (AGENTS.md)',
    path: path.join(projectRoot, 'AGENTS.md'),
  },
]

let sectionsHtml = ''
let tocItems = []

for (let i = 0; i < docFiles.length; i++) {
  const doc = docFiles[i]
  if (fs.existsSync(doc.path)) {
    const rawContent = fs.readFileSync(doc.path, 'utf8')
    const htmlContent = marked.parse(rawContent)
    const sectionId = `section-${i + 1}`

    tocItems.push({
      id: sectionId,
      number: `0${i + 1}`,
      title: doc.title,
    })

    sectionsHtml += `
      <section id="${sectionId}" class="doc-section page-break">
        <div class="section-badge">Section 0${i + 1}</div>
        <h1 class="section-title">${doc.title}</h1>
        <div class="content-body">
          ${htmlContent}
        </div>
      </section>
    `
  }
}

const tocHtml = tocItems
  .map(
    (item) => `
    <div class="toc-card">
      <span class="toc-num">${item.number}</span>
      <span class="toc-text">${item.title}</span>
    </div>
  `,
  )
  .join('')

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Fineduc — Comprehensive Technical Architecture & Project Presentation</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

    @page {
      size: A4;
      margin: 18mm 18mm 18mm 18mm;
      @bottom-right {
        content: counter(page);
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 9pt;
        color: #94a3b8;
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 10pt;
      line-height: 1.6;
      color: #1e293b;
      background-color: #ffffff;
    }

    .page-break {
      page-break-before: always;
    }

    .no-break {
      page-break-inside: avoid;
    }

    /* Cover Page */
    .cover-page {
      height: 100vh;
      min-height: 250mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 20mm 10mm;
      background: linear-gradient(145deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
      color: #ffffff;
      border-radius: 12px;
      margin-bottom: 20mm;
    }

    .cover-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      padding-bottom: 15px;
    }

    .brand-logo {
      font-size: 28pt;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #38bdf8, #818cf8, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .cover-meta-badge {
      font-size: 9pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .cover-body {
      margin: auto 0;
    }

    .cover-title {
      font-size: 34pt;
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 16px;
      letter-spacing: -1px;
    }

    .cover-subtitle {
      font-size: 14pt;
      font-weight: 400;
      color: #94a3b8;
      max-width: 650px;
      line-height: 1.5;
      margin-bottom: 30px;
    }

    .cover-highlights {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 30px;
    }

    .highlight-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 16px;
      border-radius: 8px;
    }

    .highlight-title {
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #38bdf8;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .highlight-val {
      font-size: 11pt;
      font-weight: 600;
      color: #f8fafc;
    }

    .cover-footer {
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      color: #64748b;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      padding-top: 15px;
    }

    /* Table of Contents Page */
    .toc-page {
      padding: 10mm 0;
    }

    .toc-header {
      font-size: 22pt;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 25px;
      border-bottom: 3px solid #3b82f6;
      padding-bottom: 10px;
    }

    .toc-grid {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 20px;
    }

    .toc-card {
      display: flex;
      align-items: center;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 16px 20px;
      border-radius: 8px;
    }

    .toc-num {
      font-size: 18pt;
      font-weight: 800;
      color: #3b82f6;
      margin-right: 20px;
      font-family: 'JetBrains Mono', monospace;
    }

    .toc-text {
      font-size: 12pt;
      font-weight: 600;
      color: #1e293b;
    }

    /* Content Sections */
    .doc-section {
      padding-top: 10mm;
    }

    .section-badge {
      display: inline-block;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      background: #eff6ff;
      color: #2563eb;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 8px;
      font-family: 'JetBrains Mono', monospace;
    }

    .section-title {
      font-size: 20pt;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 20px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
    }

    .content-body h1 {
      font-size: 16pt;
      font-weight: 800;
      color: #0f172a;
      margin-top: 24px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }

    .content-body h2 {
      font-size: 13pt;
      font-weight: 700;
      color: #1e293b;
      margin-top: 20px;
      margin-bottom: 10px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
      page-break-after: avoid;
    }

    .content-body h3 {
      font-size: 11pt;
      font-weight: 600;
      color: #334155;
      margin-top: 14px;
      margin-bottom: 6px;
      page-break-after: avoid;
    }

    .content-body p {
      margin-bottom: 10px;
      text-align: justify;
    }

    .content-body ul, .content-body ol {
      margin-left: 20px;
      margin-bottom: 12px;
    }

    .content-body li {
      margin-bottom: 4px;
    }

    .content-body blockquote {
      border-left: 4px solid #3b82f6;
      background: #f8fafc;
      padding: 10px 14px;
      border-radius: 0 6px 6px 0;
      margin: 14px 0;
      color: #475569;
      font-style: italic;
      page-break-inside: avoid;
    }

    .content-body code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 8.5pt;
      background: #f1f5f9;
      color: #0f172a;
      padding: 2px 5px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    .content-body pre {
      background: #0f172a;
      color: #e2e8f0;
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 14px 0;
      page-break-inside: avoid;
    }

    .content-body pre code {
      background: transparent;
      color: inherit;
      padding: 0;
      border: none;
      font-size: 8pt;
      line-height: 1.45;
    }

    .content-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 8.5pt;
      page-break-inside: avoid;
    }

    .content-body th, .content-body td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      text-align: left;
    }

    .content-body th {
      background-color: #f1f5f9;
      font-weight: 700;
      color: #0f172a;
    }

    .content-body tr:nth-child(even) {
      background-color: #f8fafc;
    }

    .content-body hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 24px 0;
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover-page">
    <div class="cover-header">
      <div class="brand-logo">Fineduc</div>
      <div class="cover-meta-badge">Technical Specification & Architecture</div>
    </div>
    
    <div class="cover-body">
      <h1 class="cover-title">Fee Collection SaaS for Private African Schools</h1>
      <p class="cover-subtitle">
        A resilient, multi-tenant platform built for the financial realities of Central & West Africa:
        integer minor-unit ledgering, Postgres Row-Level Security, multi-channel automated reminders, and real-time reconciliation.
      </p>

      <div class="cover-highlights">
        <div class="highlight-card">
          <div class="highlight-title">Architecture</div>
          <div class="highlight-val">NestJS + Postgres RLS + Redis</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-title">Financial Model</div>
          <div class="highlight-val">Append-Only Double Entry</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-title">Currency Support</div>
          <div class="highlight-val">0-decimal (XAF, XOF) + ISO</div>
        </div>
      </div>
    </div>

    <div class="cover-footer">
      <div>Author: Fineduc Engineering</div>
      <div>Confidential & Proprietary • 2026</div>
    </div>
  </div>

  <!-- Table of Contents -->
  <div class="toc-page page-break">
    <h1 class="toc-header">Table of Contents</h1>
    <div class="toc-grid">
      ${tocHtml}
    </div>
  </div>

  <!-- Markdown Sections -->
  ${sectionsHtml}

</body>
</html>
`

const htmlPath = path.join(projectRoot, 'fineduc-presentation.html')
fs.writeFileSync(htmlPath, fullHtml, 'utf8')
console.log(`Generated HTML document: ${htmlPath}`)

// Convert HTML to PDF using Microsoft Edge headless
const pdfPath = path.join(projectRoot, 'Fineduc_Project_Presentation.pdf')
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

try {
  console.log(`Exporting PDF to: ${pdfPath}...`)
  execFileSync(
    edgePath,
    [
      '--headless',
      '--disable-gpu',
      '--run-all-compositor-stages-before-draw',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      htmlPath,
    ],
    { stdio: 'inherit' },
  )
  console.log(`✅ Successfully generated presentation PDF: ${pdfPath}`)
} catch (error) {
  console.error('Error generating PDF:', error)
  process.exit(1)
}
