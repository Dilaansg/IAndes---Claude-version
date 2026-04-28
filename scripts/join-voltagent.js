/**
 * Join VoltAgent agents into OAC agent structure
 * Moves specialists into OAC category folders,
 * keeps orchestrators in subagents/voltagent/,
 * updates core primary agents to reference them.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.USERPROFILE || process.env.HOME, '.opencode', 'agent');
const VOLTAGENT_DIR = path.join(BASE, 'subagents', 'voltagent');

// Mapping: which VoltAgent specialists go into which OAC category folder
const MOVE_MAP = {
  // subagents/code/ — coding, languages, quality, security
  'code': [
    'voltagent-api-designer',
    'voltagent-backend-developer',
    'voltagent-design-bridge',
    'voltagent-electron-pro',
    'voltagent-frontend-developer',
    'voltagent-fullstack-developer',
    'voltagent-graphql-architect',
    'voltagent-microservices-architect',
    'voltagent-mobile-developer',
    'voltagent-ui-designer',
    'voltagent-websocket-engineer',
    'voltagent-typescript-pro',
    'voltagent-sql-pro',
    'voltagent-swift-expert',
    'voltagent-vue-expert',
    'voltagent-angular-architect',
    'voltagent-cpp-pro',
    'voltagent-csharp-developer',
    'voltagent-django-developer',
    'voltagent-dotnet-core-expert',
    'voltagent-dotnet-framework-4.8-expert',
    'voltagent-elixir-expert',
    'voltagent-expo-react-native-expert',
    'voltagent-fastapi-developer',
    'voltagent-flutter-expert',
    'voltagent-golang-pro',
    'voltagent-java-architect',
    'voltagent-javascript-pro',
    'voltagent-powershell-5.1-expert',
    'voltagent-powershell-7-expert',
    'voltagent-kotlin-specialist',
    'voltagent-laravel-specialist',
    'voltagent-nextjs-developer',
    'voltagent-node-specialist',
    'voltagent-php-pro',
    'voltagent-python-pro',
    'voltagent-rails-expert',
    'voltagent-react-specialist',
    'voltagent-rust-engineer',
    'voltagent-spring-boot-engineer',
    'voltagent-symfony-specialist',
    'voltagent-accessibility-tester',
    'voltagent-ad-security-reviewer',
    'voltagent-ai-writing-auditor',
    'voltagent-architect-reviewer',
    'voltagent-chaos-engineer',
    'voltagent-code-reviewer',
    'voltagent-compliance-auditor',
    'voltagent-debugger',
    'voltagent-error-detective',
    'voltagent-penetration-tester',
    'voltagent-performance-engineer',
    'voltagent-powershell-security-hardening',
    'voltagent-qa-expert',
    'voltagent-security-auditor',
    'voltagent-test-automator',
    'voltagent-ui-ux-tester',
  ],
  // subagents/development/ — infra, dx, tooling, domains
  'development': [
    'voltagent-azure-infra-engineer',
    'voltagent-cloud-architect',
    'voltagent-database-administrator',
    'voltagent-docker-expert',
    'voltagent-deployment-engineer',
    'voltagent-devops-engineer',
    'voltagent-devops-incident-responder',
    'voltagent-incident-responder',
    'voltagent-kubernetes-specialist',
    'voltagent-network-engineer',
    'voltagent-platform-engineer',
    'voltagent-security-engineer',
    'voltagent-sre-engineer',
    'voltagent-terraform-engineer',
    'voltagent-terragrunt-expert',
    'voltagent-windows-infra-admin',
    'voltagent-build-engineer',
    'voltagent-cli-developer',
    'voltagent-dependency-manager',
    'voltagent-documentation-engineer',
    'voltagent-dx-optimizer',
    'voltagent-git-workflow-manager',
    'voltagent-legacy-modernizer',
    'voltagent-mcp-developer',
    'voltagent-powershell-ui-architect',
    'voltagent-powershell-module-architect',
    'voltagent-readme-generator',
    'voltagent-refactoring-specialist',
    'voltagent-slack-expert',
    'voltagent-tooling-engineer',
    'voltagent-api-documenter',
    'voltagent-blockchain-developer',
    'voltagent-embedded-systems',
    'voltagent-fintech-engineer',
    'voltagent-game-developer',
    'voltagent-healthcare-admin',
    'voltagent-iot-engineer',
    'voltagent-m365-admin',
    'voltagent-mobile-app-developer',
    'voltagent-payment-integration',
    'voltagent-quant-analyst',
    'voltagent-risk-manager',
    'voltagent-seo-specialist',
  ],
  // subagents/core/ — meta, orchestration, coordination
  'core': [
    'voltagent-agent-installer',
    'voltagent-agent-organizer',
    'voltagent-codebase-orchestrator',
    'voltagent-context-manager',
    'voltagent-error-coordinator',
    'voltagent-it-ops-orchestrator',
    'voltagent-knowledge-synthesizer',
    'voltagent-multi-agent-coordinator',
    'voltagent-performance-monitor',
    'voltagent-task-distributor',
    'voltagent-workflow-orchestrator',
  ],
  // subagents/data-ai/ — NEW
  'data-ai': [
    'voltagent-ai-engineer',
    'voltagent-data-analyst',
    'voltagent-data-engineer',
    'voltagent-data-scientist',
    'voltagent-database-optimizer',
    'voltagent-llm-architect',
    'voltagent-machine-learning-engineer',
    'voltagent-ml-engineer',
    'voltagent-mlops-engineer',
    'voltagent-nlp-engineer',
    'voltagent-postgres-pro',
    'voltagent-prompt-engineer',
    'voltagent-reinforcement-learning-engineer',
    'voltagent-data-researcher',
  ],
  // subagents/business/ — NEW
  'business': [
    'voltagent-business-analyst',
    'voltagent-content-marketer',
    'voltagent-customer-success-manager',
    'voltagent-legal-advisor',
    'voltagent-license-engineer',
    'voltagent-product-manager',
    'voltagent-project-manager',
    'voltagent-sales-engineer',
    'voltagent-scrum-master',
    'voltagent-technical-writer',
    'voltagent-ux-researcher',
    'voltagent-wordpress-master',
  ],
  // subagents/research/ — NEW
  'research': [
    'voltagent-research-analyst',
    'voltagent-search-specialist',
    'voltagent-trend-analyst',
    'voltagent-competitive-analyst',
    'voltagent-market-researcher',
    'voltagent-project-idea-validator',
    'voltagent-data-researcher',
    'voltagent-scientific-literature-researcher',
  ],
};

// Orchestrator files that STAY in subagents/voltagent/
const ORCHESTRATORS = [
  'voltagent-core-dev',
  'voltagent-lang',
  'voltagent-infra',
  'voltagent-qa-sec',
  'voltagent-data-ai',
  'voltagent-dev-exp',
  'voltagent-domains',
  'voltagent-biz',
  'voltagent-meta',
  'voltagent-research',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`   📁 Created: ${path.relative(BASE, dir)}`);
  }
}

function moveFile(src, dest) {
  fs.renameSync(src, dest);
}

function main() {
  console.log('🔗 Joining VoltAgent agents into OAC structure\n');

  // 1. Create new category dirs
  ensureDir(path.join(BASE, 'subagents', 'data-ai'));
  ensureDir(path.join(BASE, 'subagents', 'business'));
  ensureDir(path.join(BASE, 'subagents', 'research'));

  // 2. Move specialists
  let moved = 0;
  let skipped = 0;
  for (const [category, agents] of Object.entries(MOVE_MAP)) {
    const destDir = path.join(BASE, 'subagents', category);
    ensureDir(destDir);
    for (const agentBase of agents) {
      const srcFile = path.join(VOLTAGENT_DIR, `${agentBase}.md`);
      const destFile = path.join(destDir, `${agentBase}.md`);
      if (fs.existsSync(srcFile)) {
        moveFile(srcFile, destFile);
        moved++;
      } else {
        // Try fallback in ~/.opencode/agents/voltagent
        const fallbackSrc = path.join(process.env.USERPROFILE || process.env.HOME, '.opencode', 'agents', 'voltagent', `${agentBase}.md`);
        if (fs.existsSync(fallbackSrc)) {
          fs.copyFileSync(fallbackSrc, destFile);
          moved++;
        } else {
          console.log(`   ⚠️  Missing: ${agentBase}.md`);
          skipped++;
        }
      }
    }
  }

  // 3. Verify orchestrators remain in voltagent/
  let orchOk = 0;
  for (const orch of ORCHESTRATORS) {
    const orchPath = path.join(VOLTAGENT_DIR, `${orch}.md`);
    if (fs.existsSync(orchPath)) {
      orchOk++;
    } else {
      // Copy from fallback
      const fallback = path.join(process.env.USERPROFILE || process.env.HOME, '.opencode', 'agents', 'voltagent', `${orch}.md`);
      if (fs.existsSync(fallback)) {
        fs.copyFileSync(fallback, orchPath);
        orchOk++;
      } else {
        console.log(`   ⚠️  Missing orchestrator: ${orch}.md`);
      }
    }
  }

  // 4. Clean up empty files in voltagent/
  const remaining = fs.readdirSync(VOLTAGENT_DIR);
  const expected = ORCHESTRATORS.map(o => `${o}.md`);
  const orphans = remaining.filter(f => !expected.includes(f));
  if (orphans.length > 0) {
    console.log(`\n   🧹 Cleaning ${orphans.length} orphan files from voltagent/`);
    for (const o of orphans) {
      fs.rmSync(path.join(VOLTAGENT_DIR, o), { force: true });
    }
  }

  console.log(`\n✅ Physical reorganization complete!`);
  console.log(`   Specialists moved: ${moved}`);
  console.log(`   Orchestrators kept: ${orchOk}/10`);
  console.log(`   Skipped/missing: ${skipped}`);

  // 5. Update core agents
  console.log('\n📝 Updating core primary agents...\n');

  const VOLTAGENT_BLOCK = `
## VoltAgent Plugin Orchestrators (invoke via task tool)

When a task matches a specialized domain, delegate to the appropriate VoltAgent orchestrator.
Each orchestrator will further route to its domain specialists.

| Domain | Orchestrator | Use For |
|--------|--------------|---------|
| Core Development | voltagent-core-dev | Backend, frontend, fullstack, mobile, API design |
| Language Specialists | voltagent-lang | TS, Python, Go, Rust, Java, PHP, .NET, etc. |
| Infrastructure | voltagent-infra | DevOps, cloud, K8s, Docker, Terraform, CI/CD |
| Quality & Security | voltagent-qa-sec | Testing, security audit, code review, performance |
| Data & AI | voltagent-data-ai | ML, data engineering, LLMs, MLOps, analytics |
| Developer Experience | voltagent-dev-exp | Tooling, docs, refactoring, DX, build systems |
| Specialized Domains | voltagent-domains | Blockchain, IoT, fintech, gaming, healthcare |
| Business & Product | voltagent-biz | Product management, business analysis, legal |
| Meta & Orchestration | voltagent-meta | Multi-agent coordination, workflows, automation |
| Research & Analysis | voltagent-research | Market research, competitive analysis, validation |

**Invocation syntax:**
\`\`\`javascript
task(
  subagent_type="voltagent-core-dev",
  description="Brief description",
  prompt="Detailed instructions for the orchestrator"
)
\`\`\`
`;

  // Update OpenCoder
  const opencoderPath = path.join(BASE, 'core', 'opencoder.md');
  if (fs.existsSync(opencoderPath)) {
    let opencoderContent = fs.readFileSync(opencoderPath, 'utf-8');
    if (!opencoderContent.includes('VoltAgent Plugin Orchestrators')) {
      // Insert after "## Available Subagents (invoke via task tool)"
      const marker = '## Available Subagents (invoke via task tool)';
      const idx = opencoderContent.indexOf(marker);
      if (idx !== -1) {
        const insertPos = opencoderContent.indexOf('\n', idx) + 1;
        opencoderContent = opencoderContent.slice(0, insertPos) + VOLTAGENT_BLOCK + '\n' + opencoderContent.slice(insertPos);
        fs.writeFileSync(opencoderPath, opencoderContent, 'utf-8');
        console.log('   ✅ Updated: agent/core/opencoder.md');
      } else {
        console.log('   ⚠️  Could not find insertion point in opencoder.md');
      }
    } else {
      console.log('   ℹ️  opencoder.md already has VoltAgent block');
    }
  }

  // Update OpenAgent
  const openagentPath = path.join(BASE, 'core', 'openagent.md');
  if (fs.existsSync(openagentPath)) {
    let openagentContent = fs.readFileSync(openagentPath, 'utf-8');
    if (!openagentContent.includes('VoltAgent Plugin Orchestrators')) {
      const marker = '## Available Subagents (invoke via task tool)';
      const idx = openagentContent.indexOf(marker);
      if (idx !== -1) {
        const insertPos = openagentContent.indexOf('\n', idx) + 1;
        openagentContent = openagentContent.slice(0, insertPos) + VOLTAGENT_BLOCK + '\n' + openagentContent.slice(insertPos);
        fs.writeFileSync(openagentPath, openagentContent, 'utf-8');
        console.log('   ✅ Updated: agent/core/openagent.md');
      } else {
        console.log('   ⚠️  Could not find insertion point in openagent.md');
      }
    } else {
      console.log('   ℹ️  openagent.md already has VoltAgent block');
    }
  }

  console.log('\n🎉 Join complete!');
  console.log('\n📁 Final structure:');
  console.log('   agent/core/           — Primary agents (OpenCoder, OpenAgent)');
  console.log('   agent/subagents/');
  console.log('     code/               — Coding, languages, quality, security');
  console.log('     core/               — ContextScout, TaskManager, meta-orchestration');
  console.log('     development/        — Infra, DX, tooling, specialized domains');
  console.log('     data-ai/            — ML, data engineering, LLMs');
  console.log('     business/           — Product, business, legal');
  console.log('     research/           — Research, analysis, validation');
  console.log('     system-builder/     — Context organizer');
  console.log('     voltagent/          — 10 domain orchestrators (entry points)');
}

main();
