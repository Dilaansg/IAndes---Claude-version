/**
 * =============================================================================
 * IAndes v5 — Sandbox Test Cases
 * =============================================================================
 *
 * Test scenarios for the IAndes Chrome extension v5 sandbox environment.
 * Each test case simulates a real-world prompt and validates the optimization
 * pipeline end-to-end (content script → background → server → response).
 *
 * Usage:
 *   - Open test-page.html in a browser
 *   - Run: node test-cases.js          (for Node.js assertions)
 *   - Or use the test buttons in test-page.html
 *
 * Schema references:
 *   - Request:  iandes-server/schemas/request.py  (PromptAnalysis v2.0)
 *   - Response: iandes-server/schemas/response.py  (OptimizationResult)
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SERVER_BASE = 'http://localhost:8000';
const SERVER_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------
const TEST_CASES = [
    // =========================================================================
    // TC-01: Cortesía + pregunta sustancial (Spanish)
    // Expected: Remove greeting, remove "podrías ayudar", keep core question
    // =========================================================================
    {
        id: 'TC-01',
        name: 'Cortesía + pregunta sustancial',
        description: 'Prompt con saludo, cortesía y pregunta concreta. Debe eliminar relleno y mantener la intención.',
        input: 'Hola, me podrías ayudar haciendo un resumen de la segunda guerra mundial, teniendo en cuenta los principales detonantes?',
        mode: 'compress',
        assertions: {
            tokensSaved: (v) => v > 0,
            similarityScore: (v) => v >= 0.80,
            optimizedPrompt: (v) => {
                // Should NOT contain greeting words
                const lower = v.toLowerCase();
                return !lower.startsWith('hola') && !lower.includes('podrías');
            },
            hasSegments: true,
            qualityWarning: false,
        },
    },

    // =========================================================================
    // TC-02: Cortesía + solicitud vaga (Spanish)
    // Expected: Remove greeting, remove "me ayudas", keep core request
    // =========================================================================
    {
        id: 'TC-02',
        name: 'Cortesía + solicitud vaga',
        description: 'Prompt con saludo nocturno y solicitud genérica. Debe limpiar cortesía.',
        input: 'Hola buenas noches, me ayudas con un trabajo de la universidad?',
        mode: 'compress',
        assertions: {
            tokensSaved: (v) => v > 0,
            similarityScore: (v) => v >= 0.80,
            optimizedPrompt: (v) => {
                const lower = v.toLowerCase();
                return !lower.startsWith('hola') && !lower.includes('buenas noches');
            },
            hasSegments: true,
            qualityWarning: false,
        },
    },

    // =========================================================================
    // TC-03: Prompt con código (backticks)
    // Expected: Code blocks should be preserved, courtesy removed
    // =========================================================================
    {
        id: 'TC-03',
        name: 'Código con backticks',
        description: 'Prompt con bloque de código y cortesía. Debe preservar código y eliminar relleno.',
        input: '```python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n```\n\nExplícame este código paso a paso de forma detallada y con ejemplos por favor',
        mode: 'compress',
        assertions: {
            tokensSaved: (v) => v >= 0, // May save little if code is dominant
            similarityScore: (v) => v >= 0.85,
            optimizedPrompt: (v) => {
                // Code block should be preserved
                return v.includes('```python') || v.includes('fibonacci');
            },
            hasSegments: true,
        },
    },

    // =========================================================================
    // TC-04: Prompt corto (< 8 palabras)
    // Expected: Minimal or no optimization — already concise
    // =========================================================================
    {
        id: 'TC-04',
        name: 'Prompt corto',
        description: 'Prompt muy corto (< 8 palabras). No debería haber optimización significativa.',
        input: 'Qué es Python?',
        mode: 'compress',
        assertions: {
            tokensSaved: (v) => v >= 0, // May be 0 for short prompts
            similarityScore: (v) => v >= 0.90, // Should be very similar
            qualityWarning: false,
        },
    },

    // =========================================================================
    // TC-05: Preguntas múltiples con signos de interrogación
    // Expected: Remove courtesy, keep all questions as constraints
    // =========================================================================
    {
        id: 'TC-05',
        name: 'Preguntas múltiples',
        description: 'Prompt con múltiples preguntas y cortesía. Debe mantener las preguntas y eliminar relleno.',
        input: '¿Cuáles son las causas de la Revolución Francesa? ¿Qué impacto tuvo en Europa? ¿Cómo influyó en la independencia de América Latina? ¿Podrías responder de forma detallada por favor?',
        mode: 'compress',
        assertions: {
            tokensSaved: (v) => v > 0,
            similarityScore: (v) => v >= 0.80,
            optimizedPrompt: (v) => {
                const lower = v.toLowerCase();
                return !lower.includes('por favor') && !lower.includes('podrías');
            },
            hasSegments: true,
        },
    },

    // =========================================================================
    // TC-06: Servidor no disponible
    // Expected: Error handling — should show error message gracefully
    // =========================================================================
    {
        id: 'TC-06',
        name: 'Servidor no disponible',
        description: 'Simula la caída del servidor. Debe manejar el error gracefully.',
        input: 'Hola, podrías ayudarme con algo?',
        mode: 'compress',
        simulateServerError: true,
        assertions: {
            shouldError: true,
            errorCode: 'SERVER_UNAVAILABLE',
        },
    },

    // =========================================================================
    // TC-07: Modo compress vs enhance
    // Expected: compress removes filler; enhance restructures
    // =========================================================================
    {
        id: 'TC-07',
        name: 'Comprimir vs Mejorar',
        description: 'Mismo prompt en ambos modos. Comprimir debe reducir tokens; mejorar debe reestructurar.',
        input: 'Hola, me podrías hacer un análisis detallado y exhaustivo de las causas económicas de la Primera Guerra Mundial, teniendo en cuenta todos los factores geopolíticos y sociales que influyeron en el conflicto, por favor?',
        mode: 'compress',
        companionMode: 'enhance',
        assertions: {
            tokensSaved: (v) => v > 0,
            similarityScore: (v) => v >= 0.80,
            optimizedPrompt: (v) => {
                const lower = v.toLowerCase();
                return !lower.includes('por favor') && !lower.includes('podrías');
            },
            hasSegments: true,
        },
    },
];

// ---------------------------------------------------------------------------
// Test runner (Node.js)
// ---------------------------------------------------------------------------

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.8);
}

async function runTestCase(testCase) {
    const results = {
        id: testCase.id,
        name: testCase.name,
        passed: true,
        errors: [],
        details: {},
    };

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${testCase.id}: ${testCase.name}`);
    console.log(`  Input: "${testCase.input.substring(0, 80)}${testCase.input.length > 80 ? '...' : ''}"`);
    console.log(`  Mode: ${testCase.mode}`);
    console.log(`${'='.repeat(60)}`);

    // Build PromptAnalysis v2.0 payload
    const payload = {
        version: '2.0',
        request_id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        raw_prompt: testCase.input,
        mode: testCase.mode,
        preflight: {
            intent: 'general',
            confidence: 0.7,
            estimated_tokens: estimateTokens(testCase.input),
            language: 'es',
            has_code_blocks: testCase.input.includes('```'),
            paragraph_count: 1,
        },
        constraints: {
            max_output_tokens: null,
            preserve_entities: true,
            quality_floor: 0.85,
        },
        metadata: {
            source: 'sandbox-test',
            timestamp: Date.now(),
        },
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);

        const resp = await fetch(`${SERVER_BASE}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
            if (testCase.assertions.shouldError) {
                console.log(`  ✓ Expected error (status ${resp.status})`);
                results.details.status = resp.status;
                return results;
            }
            results.passed = false;
            results.errors.push(`HTTP ${resp.status}`);
            return results;
        }

        const data = await resp.json();
        results.details = data;

        console.log(`  Optimized: "${data.optimized_prompt.substring(0, 80)}${data.optimized_prompt.length > 80 ? '...' : ''}"`);
        console.log(`  Tokens: ${data.original_tokens} → ${data.optimized_tokens} (saved: ${data.savings.tokens_saved})`);
        console.log(`  Similarity: ${(data.similarity_score * 100).toFixed(1)}%`);
        console.log(`  Segments: ${data.segments.length}`);
        console.log(`  Pipeline: ${data.pipeline_ms.total}ms`);
        console.log(`  Quality warning: ${data.quality_warning}`);

        // Run assertions
        const assertions = testCase.assertions;

        if (assertions.tokensSaved) {
            const val = data.savings.tokens_saved;
            if (!assertions.tokensSaved(val)) {
                results.passed = false;
                results.errors.push(`tokensSaved assertion failed: got ${val}`);
            } else {
                console.log(`  ✓ tokensSaved: ${val}`);
            }
        }

        if (assertions.similarityScore) {
            const val = data.similarity_score;
            if (!assertions.similarityScore(val)) {
                results.passed = false;
                results.errors.push(`similarityScore assertion failed: got ${val}`);
            } else {
                console.log(`  ✓ similarityScore: ${(val * 100).toFixed(1)}%`);
            }
        }

        if (assertions.optimizedPrompt) {
            const val = data.optimized_prompt;
            if (!assertions.optimizedPrompt(val)) {
                results.passed = false;
                results.errors.push(`optimizedPrompt assertion failed: got "${val.substring(0, 60)}"`);
            } else {
                console.log(`  ✓ optimizedPrompt: passes assertion`);
            }
        }

        if (assertions.hasSegments !== undefined) {
            if (assertions.hasSegments && data.segments.length === 0) {
                results.passed = false;
                results.errors.push('Expected segments but got none');
            } else {
                console.log(`  ✓ hasSegments: ${data.segments.length} segments`);
            }
        }

        if (assertions.qualityWarning !== undefined) {
            if (data.quality_warning !== assertions.qualityWarning) {
                results.passed = false;
                results.errors.push(`qualityWarning assertion failed: expected ${assertions.qualityWarning}, got ${data.quality_warning}`);
            } else {
                console.log(`  ✓ qualityWarning: ${data.quality_warning}`);
            }
        }

        // Validate OptimizationResult schema completeness
        const requiredFields = ['request_id', 'server_version', 'optimized_prompt', 'original_tokens',
            'optimized_tokens', 'similarity_score', 'segments', 'savings', 'pipeline_ms', 'quality_warning'];
        for (const field of requiredFields) {
            if (data[field] === undefined) {
                results.passed = false;
                results.errors.push(`Missing required field: ${field}`);
            }
        }

        // Validate Savings schema
        const savingsFields = ['tokens_saved', 'co2_grams_saved', 'water_ml_saved', 'methodology_ref'];
        for (const field of savingsFields) {
            if (data.savings?.[field] === undefined) {
                results.passed = false;
                results.errors.push(`Missing savings field: ${field}`);
            }
        }

        // Validate PipelineMs schema
        const pipelineFields = ['d1_verifier', 'd2_segmenter', 'd3_budget', 'd4_pruner', 'd5_validator', 'd6_rebuilder', 'total'];
        for (const field of pipelineFields) {
            if (data.pipeline_ms?.[field] === undefined) {
                results.passed = false;
                results.errors.push(`Missing pipeline_ms field: ${field}`);
            }
        }

        // Validate Segment schema (if present)
        if (data.segments && data.segments.length > 0) {
            const segFields = ['text', 'label', 'kept', 'compression_ratio'];
            for (const seg of data.segments) {
                for (const field of segFields) {
                    if (seg[field] === undefined) {
                        results.passed = false;
                        results.errors.push(`Missing segment field: ${field}`);
                    }
                }
                // Validate label values
                const validLabels = ['intent', 'constraint', 'context_high', 'context_low', 'filler'];
                if (!validLabels.includes(seg.label)) {
                    results.passed = false;
                    results.errors.push(`Invalid segment label: ${seg.label}`);
                }
            }
        }

    } catch (err) {
        if (testCase.assertions.shouldError) {
            console.log(`  ✓ Expected error: ${err.message}`);
            results.details.error = err.message;
        } else {
            results.passed = false;
            results.errors.push(`Request failed: ${err.message}`);
            console.log(`  ✗ Request failed: ${err.message}`);
        }
    }

    return results;
}

async function runCompanionTest(testCase) {
    /**
     * Run the same prompt in the companion mode (e.g., enhance vs compress)
     * to compare results.
     */
    if (!testCase.companionMode) return null;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${testCase.id} (companion mode: ${testCase.companionMode})`);
    console.log(`${'─'.repeat(60)}`);

    const payload = {
        version: '2.0',
        request_id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        raw_prompt: testCase.input,
        mode: testCase.companionMode,
        preflight: {
            intent: 'general',
            confidence: 0.7,
            estimated_tokens: estimateTokens(testCase.input),
            language: 'es',
            has_code_blocks: testCase.input.includes('```'),
            paragraph_count: 1,
        },
        constraints: {
            max_output_tokens: null,
            preserve_entities: true,
            quality_floor: 0.85,
        },
        metadata: {
            source: 'sandbox-test',
            timestamp: Date.now(),
        },
    };

    try {
        const resp = await fetch(`${SERVER_BASE}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            console.log(`  ✗ HTTP ${resp.status}`);
            return { mode: testCase.companionMode, error: `HTTP ${resp.status}` };
        }

        const data = await resp.json();
        console.log(`  Mode: ${testCase.companionMode}`);
        console.log(`  Optimized: "${data.optimized_prompt.substring(0, 80)}${data.optimized_prompt.length > 80 ? '...' : ''}"`);
        console.log(`  Tokens: ${data.original_tokens} → ${data.optimized_tokens}`);
        console.log(`  Similarity: ${(data.similarity_score * 100).toFixed(1)}%`);
        return data;
    } catch (err) {
        console.log(`  ✗ Error: ${err.message}`);
        return { mode: testCase.companionMode, error: err.message };
    }
}

async function runAllTests() {
    console.log('\n' + '═'.repeat(60));
    console.log('  IAndes v5 — Sandbox Test Suite');
    console.log('  ' + new Date().toISOString());
    console.log('═'.repeat(60));

    // Check server health first
    console.log('\n[Health Check]');
    try {
        const resp = await fetch(`${SERVER_BASE}/health`);
        if (resp.ok) {
            const data = await resp.json();
            console.log(`  ✓ Server: ${data.status} (v${data.version})`);
            console.log(`  ✓ spaCy: ${data.spacy_ready ? 'ready' : 'not ready'}`);
            console.log(`  ✓ Sentence model: ${data.sentence_model_ready ? 'ready' : 'not ready'}`);
        } else {
            console.log(`  ✗ Server responded with status ${resp.status}`);
        }
    } catch (e) {
        console.log(`  ✗ Server not available: ${e.message}`);
        console.log('  Start the server with: python test-server.py');
        process.exit(1);
    }

    // Run all test cases
    const allResults = [];
    for (const tc of TEST_CASES) {
        if (tc.simulateServerError) {
            // Skip server error test in automated runner (requires manual setup)
            console.log(`\n${'='.repeat(60)}`);
            console.log(`  ${tc.id}: ${tc.name} — SKIPPED (requires manual server shutdown)`);
            console.log(`${'='.repeat(60)}`);
            allResults.push({ id: tc.id, name: tc.name, passed: true, skipped: true, errors: [] });
            continue;
        }
        const result = await runTestCase(tc);
        allResults.push(result);

        // Run companion mode test if specified
        if (tc.companionMode) {
            const companionResult = await runCompanionTest(tc);
            result.companionResult = companionResult;
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('  Test Summary');
    console.log('═'.repeat(60));

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of allResults) {
        if (r.skipped) {
            skipped++;
            console.log(`  ⊘ ${r.id}: ${r.name} — SKIPPED`);
        } else if (r.passed) {
            passed++;
            console.log(`  ✓ ${r.id}: ${r.name} — PASSED`);
        } else {
            failed++;
            console.log(`  ✗ ${r.id}: ${r.name} — FAILED`);
            r.errors.forEach(e => console.log(`    - ${e}`));
        }
    }

    console.log(`\n  Total: ${allResults.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
    console.log();

    if (failed > 0) {
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Export for both Node.js and browser
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TEST_CASES, runAllTests, runTestCase, runCompanionTest };
}

// Auto-run if executed directly in Node.js
if (typeof require !== 'undefined' && require.main === module) {
    runAllTests().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

// For browser: attach to window
if (typeof window !== 'undefined') {
    window.IANDES_TEST_CASES = TEST_CASES;
    window.IANDES_RUN_ALL_TESTS = runAllTests;
    window.IANDES_RUN_TEST_CASE = runTestCase;
}