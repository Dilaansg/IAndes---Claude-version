/**
 * VoltAgent → OpenCode Agent Converter
 * Downloads the awesome-claude-code-subagents repo and converts agents
 * into OpenCode-compatible markdown agents with main orchestrators.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────
const REPO_URL = 'https://github.com/VoltAgent/awesome-claude-code-subagents.git';
const TEMP_REPO = path.join(__dirname, '.tmp', 'voltagent-repo');
const OUTPUT_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.opencode', 'agents', 'voltagent');
const OAC_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.opencode', 'agent', 'subagents', 'voltagent');

// Category metadata
const CATEGORIES = {
  '01-core-development': {
    id: 'core-dev',
    name: 'Core Development',
    description: 'Use for backend, frontend, fullstack, mobile, API design, and general software development tasks.'
  },
  '02-language-specialists': {
    id: 'lang',
    name: 'Language Specialists',
    description: 'Use for language-specific or framework-specific development tasks (TypeScript, Python, Go, Rust, etc.).'
  },
  '03-infrastructure': {
    id: 'infra',
    name: 'Infrastructure',
    description: 'Use for DevOps, cloud, Kubernetes, Docker, Terraform, deployment, and infrastructure tasks.'
  },
  '04-quality-security': {
    id: 'qa-sec',
    name: 'Quality & Security',
    description: 'Use for testing, security auditing, code review, performance optimization, and QA tasks.'
  },
  '05-data-ai': {
    id: 'data-ai',
    name: 'Data & AI',
    description: 'Use for data engineering, machine learning, AI system design, and analytics tasks.'
  },
  '06-developer-experience': {
    id: 'dev-exp',
    name: 'Developer Experience',
    description: 'Use for tooling, documentation, refactoring, build systems, and developer productivity tasks.'
  },
  '07-specialized-domains': {
    id: 'domains',
    name: 'Specialized Domains',
    description: 'Use for domain-specific technology tasks (blockchain, IoT, fintech, gaming, healthcare, etc.).'
  },
  '08-business-product': {
    id: 'biz',
    name: 'Business & Product',
    description: 'Use for product management, business analysis, content marketing, and legal/compliance tasks.'
  },
  '09-meta-orchestration': {
    id: 'meta',
    name: 'Meta & Orchestration',
    description: 'Use for multi-agent coordination, workflow automation, context management, and task distribution.'
  },
  '10-research-analysis': {
    id: 'research',
    name: 'Research & Analysis',
    description: 'Use for research, competitive analysis, market research, and scientific literature review tasks.'
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function parseClaudeFrontmatter(content) {
  // Normalize line endings to \n for reliable parsing
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: normalized };

  const yamlLines = match[1].split('\n');
  const frontmatter = {};
  for (const line of yamlLines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      // Remove surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body: match[2] };
}

function convertToolsToPermission(toolsStr) {
  const tools = (toolsStr || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const perm = {};

  // Map Claude tools to OpenCode permission keys
  const toolMap = {
    'read': 'read',
    'write': 'write',
    'edit': 'edit',
    'bash': 'bash',
    'glob': 'glob',
    'grep': 'grep',
    'webfetch': 'read', // OpenCode doesn't have webfetch tool per se; read covers it
    'websearch': 'read'
  };

  for (const tool of tools) {
    const mapped = toolMap[tool];
    if (mapped) {
      perm[mapped] = { '*': 'allow' };
    }
  }

  // Default: allow read if nothing specified, or if it's a code-writing agent
  if (Object.keys(perm).length === 0) {
    perm['read'] = { '*': 'allow' };
  }

  return perm;
}

function buildMainOrchestrator(categoryKey, categoryMeta, specialists) {
  const agentId = `voltagent-${categoryMeta.id}`;
  const agentName = `VoltAgent ${categoryMeta.name}`;

  // Build specialist table
  const specialistRows = specialists.map(s => {
    const displayName = s.name.replace(/-/g, ' ');
    return `- **@${s.agentId}** — ${s.description || displayName}`;
  }).join('\n');

  const delegationTable = specialists.map(s => {
    const displayName = s.name.replace(/-/g, ' ');
    return `| ${s.description || displayName} | @${s.agentId} |`;
  }).join('\n');

  const frontmatter = `---
description: "${agentName} orchestrator. ${categoryMeta.description}"
mode: subagent
temperature: 0.1
permission:
  read:
    "*": "allow"
  write:
    "*": "allow"
  edit:
    "*": "allow"
  bash:
    "*": "ask"
  task:
    "voltagent-*": "allow"
---
`;

  const body = `
You are the **${agentName}** orchestrator. You coordinate specialized subagents within the ${categoryMeta.name} domain.

## Available Specialists

${specialistRows}

## When to Delegate

Analyze the user's request and delegate to the most appropriate specialist:

| Task Type | Delegate To |
|-----------|-------------|
${delegationTable}

## Delegation Protocol

When a task clearly matches a specialist's domain:
1. Use the **Task tool** to invoke the specialist subagent
2. Pass the full context and requirements in the prompt
3. Specify expected deliverables and output format
4. Wait for the specialist to complete before synthesizing or presenting results
5. If multiple specialists are needed, invoke them sequentially or in parallel batches

## Direct Execution

If the task is general and does not clearly match a single specialist, handle it yourself using your broad expertise in ${categoryMeta.name}. Only delegate when a specialist would produce significantly better results.
`;

  return frontmatter + body;
}

function convertSpecialist(filePath, categoryPrefix) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseClaudeFrontmatter(content);

  const rawName = frontmatter.name || path.basename(filePath, '.md');
  const agentId = `voltagent-${rawName}`;
  const description = frontmatter.description || `Specialist for ${rawName.replace(/-/g, ' ')}`;
  const permission = convertToolsToPermission(frontmatter.tools);

  // Build OpenCode frontmatter
  const lines = [
    '---',
    `description: "${description.replace(/"/g, '\\"')}"`,
    'mode: subagent',
    'temperature: 0.1',
    'permission:'
  ];

  for (const [tool, rules] of Object.entries(permission)) {
    lines.push(`  ${tool}:`);
    for (const [pattern, action] of Object.entries(rules)) {
      lines.push(`    "${pattern}": "${action}"`);
    }
  }

  lines.push('---');
  lines.push('');

  // Prepend identity note to body
  const identityNote = `\n> **Identity:** You are the **${rawName}** specialist, part of the VoltAgent ${CATEGORIES[categoryPrefix]?.name || ''} collection.\n`;

  return lines.join('\n') + identityNote + '\n' + body;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 VoltAgent → OpenCode Converter');
  console.log('=====================================\n');

  // 1. Clone repo
  console.log('📥 Cloning VoltAgent repository...');
  cleanDir(TEMP_REPO);
  try {
    execSync(`git clone --depth 1 "${REPO_URL}" "${TEMP_REPO}"`, {
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (err) {
    console.error('❌ Failed to clone repo:', err.message);
    process.exit(1);
  }

  // 2. Prepare output directories
  cleanDir(OUTPUT_DIR);
  cleanDir(OAC_DIR);

  const categoriesDir = path.join(TEMP_REPO, 'categories');
  if (!fs.existsSync(categoriesDir)) {
    console.error('❌ categories/ directory not found in cloned repo');
    process.exit(1);
  }

  const categoryDirs = fs.readdirSync(categoriesDir).filter(d => /^\d+/.test(d));
  let totalSpecialists = 0;
  let totalMain = 0;

  // 3. Process each category
  for (const catDir of categoryDirs) {
    const catPath = path.join(categoriesDir, catDir);
    if (!fs.statSync(catPath).isDirectory()) continue;

    const catMeta = CATEGORIES[catDir];
    if (!catMeta) {
      console.warn(`⚠️  Unknown category: ${catDir}, skipping`);
      continue;
    }

    console.log(`\n📂 Processing category: ${catMeta.name} (${catDir})`);

    const files = fs.readdirSync(catPath).filter(f => f.endsWith('.md'));
    const specialists = [];

    // Convert each specialist
    for (const file of files) {
      const filePath = path.join(catPath, file);
      const rawName = path.basename(file, '.md');
      const agentId = `voltagent-${rawName}`;

      const { frontmatter } = parseClaudeFrontmatter(fs.readFileSync(filePath, 'utf-8'));
      specialists.push({
        name: rawName,
        agentId,
        description: frontmatter.description || rawName.replace(/-/g, ' ')
      });

      const converted = convertSpecialist(filePath, catDir);
      const outFile = `${agentId}.md`;

      fs.writeFileSync(path.join(OUTPUT_DIR, outFile), converted, 'utf-8');
      fs.writeFileSync(path.join(OAC_DIR, outFile), converted, 'utf-8');
      totalSpecialists++;
    }

    // Create main orchestrator
    const mainContent = buildMainOrchestrator(catDir, catMeta, specialists);
    const mainFile = `voltagent-${catMeta.id}.md`;

    fs.writeFileSync(path.join(OUTPUT_DIR, mainFile), mainContent, 'utf-8');
    fs.writeFileSync(path.join(OAC_DIR, mainFile), mainContent, 'utf-8');
    totalMain++;

    console.log(`   ✅ ${specialists.length} specialists + 1 orchestrator`);
  }

  // 4. Summary
  console.log('\n=====================================');
  console.log('✅ Conversion complete!');
  console.log(`   Main orchestrators: ${totalMain}`);
  console.log(`   Specialist agents:  ${totalSpecialists}`);
  console.log(`\n📁 Installed to:`);
  console.log(`   ${OUTPUT_DIR}`);
  console.log(`   ${OAC_DIR}`);
  console.log('\n🎯 Usage in OpenCode:');
  console.log('   @voltagent-core-dev   → Core development tasks');
  console.log('   @voltagent-lang       → Language/framework tasks');
  console.log('   @voltagent-infra      → Infrastructure tasks');
  console.log('   @voltagent-qa-sec     → Quality & security tasks');
  console.log('   @voltagent-data-ai    → Data & AI tasks');
  console.log('   @voltagent-dev-exp    → Developer experience tasks');
  console.log('   @voltagent-domains    → Specialized domain tasks');
  console.log('   @voltagent-biz        → Business & product tasks');
  console.log('   @voltagent-meta       → Meta & orchestration tasks');
  console.log('   @voltagent-research   → Research & analysis tasks');

  // 5. Cleanup
  console.log('\n🧹 Cleaning up temp files...');
  fs.rmSync(TEMP_REPO, { recursive: true, force: true });
  console.log('Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
