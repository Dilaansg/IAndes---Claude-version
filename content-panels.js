// content-panels.js
// Paneles de revisión antes/después
// v5: Sin hint de Capa 1 — el flujo es directo al SW

// OPTIMIZE_HINT_ID ya está disponible globalmente desde config.js

/**
 * Oculta el hint de optimización si existe.
 */
function hideOptimizeHint() {
    const hint = document.getElementById(self.OPTIMIZE_HINT_ID);
    if (hint) {
        hint.style.opacity = '0';
        hint.style.transition = 'opacity 0.3s';
        setTimeout(() => hint.remove(), 300);
    }
}

/**
 * Panel de preview antes/después con diseño mejorado.
 * @param {string} originalText - Texto original
 * @param {string} compressedText - Texto comprimido
 * @param {object} stats - Estadísticas
 */
function renderCompressReviewPanel(originalText, compressedText, stats) {
    const overlay = getOrCreateOverlay();
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
    const panel = document.createElement('div');
    panel.id = 'iandes-compress-panel';
    panel.style.cssText = 'margin-top:8px;';

    // v5: Quality warning banner
    if (stats?.qualityWarning) {
        const banner = document.createElement('div');
        banner.style.cssText = 'background:rgba(255,193,7,0.1);border:1px solid #ffc107;border-radius:8px;padding:8px 10px;margin-bottom:8px;';
        banner.innerHTML = `
            <div style="color:#ffc107;font-size:10px;font-weight:600;margin-bottom:2px;">⚠ Advertencia de calidad</div>
            <div style="color:#9d9d9d;font-size:9px;line-height:1.4;">La similitud semántica está por debajo del umbral. El prompt optimizado puede haber perdido información importante.</div>
        `;
        panel.appendChild(banner);
    }

    // v5: Segment-annotated view (if segments available)
    if (stats?.segments && stats.segments.length > 0) {
        const segContainer = document.createElement('div');
        segContainer.style.cssText = 'margin-bottom:8px;';

        const segLabel = document.createElement('div');
        segLabel.style.cssText = 'color:#6b8a78;font-size:9px;font-weight:600;margin-bottom:4px;';
        segLabel.textContent = 'SEGMENTOS';
        segContainer.appendChild(segLabel);

        const LABEL_COLORS = {
            intent: { bg: 'rgba(0,230,150,0.15)', border: '#00e696', text: '#00e696' },
            constraint: { bg: 'rgba(66,133,244,0.15)', border: '#4285f4', text: '#4285f4' },
            context_high: { bg: 'rgba(255,193,7,0.15)', border: '#ffc107', text: '#ffc107' },
            context_low: { bg: 'rgba(255,152,0,0.15)', border: '#ff9800', text: '#ff9800' },
            filler: { bg: 'rgba(244,67,54,0.15)', border: '#f44336', text: '#f44336' },
        };

        const LABEL_NAMES = {
            intent: 'Intención',
            constraint: 'Restricción',
            context_high: 'Contexto relevante',
            context_low: 'Contexto accesorio',
            filler: 'Relleno',
        };

        for (const seg of stats.segments) {
            const colors = LABEL_COLORS[seg.label] || LABEL_COLORS.context_low;
            const isKept = seg.kept !== false;
            const ratio = seg.compression_ratio != null ? Math.round(seg.compression_ratio * 100) : (isKept ? 100 : 0);

            const segEl = document.createElement('div');
            segEl.style.cssText = `
                background:${colors.bg};
                border-left:3px solid ${colors.border};
                border-radius:4px;
                padding:4px 8px;
                margin-bottom:3px;
                font-size:10px;
                line-height:1.4;
                word-break:break-word;
                ${!isKept ? 'text-decoration:line-through;opacity:0.5;' : ''}
            `;

            const segHeader = document.createElement('div');
            segHeader.style.cssText = `display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;`;
            segHeader.innerHTML = `
                <span style="color:${colors.text};font-weight:600;font-size:9px;">${LABEL_NAMES[seg.label] || seg.label}</span>
                <span style="color:#6b8a78;font-size:8px;">${isKept ? ratio + '%' : 'eliminado'}</span>
            `;
            segEl.appendChild(segHeader);

            const segText = document.createElement('div');
            segText.style.cssText = 'color:#9d9d9d;font-size:9px;';
            segText.textContent = isKept ? (seg.text_compressed || seg.text || '') : seg.text || '';
            if (!isKept) segText.style.textDecoration = 'line-through';
            segEl.appendChild(segText);

            segContainer.appendChild(segEl);
        }

        panel.appendChild(segContainer);
    }

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';

    const title = document.createElement('div');
    title.style.cssText = 'color:#00e696;font-weight:600;font-size:11px;';
    const savedPct = stats?.savedPct || (stats?.savedTokens && stats?.originalTokens ? Math.round((stats.savedTokens / stats.originalTokens) * 100) : 0);
    title.textContent = `✓ −${stats?.savedTokens || 0} tokens (${savedPct}%)`;
    titleRow.appendChild(title);

    // v5: Similarity score badge
    if (stats?.similarityScore != null) {
        const simBadge = document.createElement('span');
        const simPct = Math.round(stats.similarityScore * 100);
        const simColor = simPct >= 85 ? '#00e696' : simPct >= 70 ? '#ffc107' : '#ff6b6b';
        simBadge.style.cssText = `font-size:9px;color:${simColor};margin-left:6px;font-weight:400;`;
        simBadge.textContent = `sim: ${simPct}%`;
        titleRow.appendChild(simBadge);
    }

    if (stats?.pending) {
        const spinner = document.createElement('span');
        spinner.id = 'iandes-panel-spinner';
        spinner.style.cssText = 'font-size:9px;color:#6b8a78;animation:pulse 1s infinite;';
        spinner.textContent = '⟳ mejorando…';
        titleRow.appendChild(spinner);
    }
    panel.appendChild(titleRow);

    // ANTES
    const antesWrap = document.createElement('div');
    antesWrap.style.cssText = 'background:#1a1a2e;border-radius:8px;padding:8px 10px;margin-bottom:6px;';
    const antesLabel = document.createElement('div');
    antesLabel.style.cssText = 'color:#6b8f71;font-size:9px;font-weight:600;margin-bottom:4px;';
    antesLabel.textContent = 'ANTES';
    antesWrap.appendChild(antesLabel);
    const antesText = document.createElement('div');
    antesText.style.cssText = 'color:#9d9d9d;font-size:10px;line-height:1.4;word-break:break-word;';
    antesText.textContent = originalText;
    antesWrap.appendChild(antesText);
    panel.appendChild(antesWrap);

    // DESPUÉS
    const despuesWrap = document.createElement('div');
    despuesWrap.style.cssText = 'background:rgba(0,230,150,0.05);border-radius:8px;padding:8px 10px;margin-bottom:6px;';
    const despuesLabel = document.createElement('div');
    despuesLabel.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#00e696;font-size:9px;font-weight:600;margin-bottom:4px;';
    despuesLabel.innerHTML = 'DESPUÉS <span id="iandes-edit-hint" style="color:#6b8a78;font-size:8px;font-weight:400;">(haz clic en editar)</span>';
    despuesWrap.appendChild(despuesLabel);
    const despuesText = document.createElement('div');
    despuesText.id = 'iandes-compressed-text';
    despuesText.style.cssText = 'color:#ffffff;font-size:10px;line-height:1.4;word-break:break-word;outline:none;';
    despuesText.textContent = compressedText;
    despuesText.contentEditable = false;
    despuesWrap.appendChild(despuesText);
    panel.appendChild(despuesWrap);

    // v5: Environmental savings metrics
    if (stats?.savings || stats?.savedTokens > 0) {
        const savingsWrap = document.createElement('div');
        savingsWrap.style.cssText = 'background:rgba(0,230,150,0.05);border-radius:8px;padding:6px 10px;margin-bottom:6px;display:flex;gap:12px;justify-content:center;';

        const co2 = stats?.savings?.co2_grams_saved || (stats.savedTokens * 0.0023);
        const water = stats?.savings?.water_ml_saved || (stats.savedTokens * 0.50);

        savingsWrap.innerHTML = `
            <div style="text-align:center;">
                <div style="color:#00e696;font-size:11px;font-weight:600;">${co2 < 1 ? (co2 * 1000).toFixed(0) + 'mg' : co2.toFixed(2) + 'g'}</div>
                <div style="color:#6b8a78;font-size:8px;">CO2 ahorrado</div>
            </div>
            <div style="text-align:center;">
                <div style="color:#4285f4;font-size:11px;font-weight:600;">${water < 1 ? (water * 1000).toFixed(0) + 'μl' : water.toFixed(1) + 'ml'}</div>
                <div style="color:#6b8a78;font-size:8px;">agua ahorrada</div>
            </div>
            <div style="text-align:center;">
                <div style="color:#ffc107;font-size:11px;font-weight:600;">${stats.savedTokens}</div>
                <div style="color:#6b8a78;font-size:8px;">tokens</div>
            </div>
        `;
        panel.appendChild(savingsWrap);

        // v5: Methodology reference when server data is available
        if (stats?.savings?.methodology_ref) {
            const methodHint = document.createElement('div');
            methodHint.style.cssText = 'color:#6b8a78;font-size:7px;margin-top:2px;text-align:center;font-style:italic;';
            methodHint.textContent = stats.savings.methodology_ref;
            panel.appendChild(methodHint);
        }
    }

    // Botón Editar
    const editBtn = document.createElement('button');
    editBtn.id = 'iandes-edit-btn';
    editBtn.textContent = '✎ Editar';
    editBtn.style.cssText = 'width:100%;padding:4px 8px;background:transparent;color:#6b8a78;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:10px;pointer-events:auto;font-family:inherit;margin-bottom:6px;';
    editBtn.onclick = () => {
        despuesText.contentEditable = true;
        despuesText.style.background = 'rgba(255,255,255,0.05)';
        despuesText.style.borderRadius = '4px';
        despuesText.style.padding = '2px';
        despuesText.focus();
        editBtn.textContent = '✓ Listo';
        editBtn.style.color = '#00e696';
        editBtn.style.borderColor = '#00e696';
        const hint = document.getElementById('iandes-edit-hint');
        if (hint) hint.textContent = '(editando…)';
    };
    panel.appendChild(editBtn);

    // Botones Aceptar/Descartar
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Aceptar y reemplazar';
    applyBtn.style.cssText = 'flex:1;padding:5px 8px;background:#00e696;color:#000;border:none;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;pointer-events:auto;font-family:inherit;';
    applyBtn.onclick = () => {
        const editedText = despuesText.textContent;
        injectOptimizedPrompt(editedText, stats, 'compress');
    };

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Descartar';
    discardBtn.style.cssText = 'flex:1;padding:5px 8px;background:transparent;color:#6b8a78;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:10px;pointer-events:auto;font-family:inherit;';
    discardBtn.onclick = () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
            [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
            overlay.style.opacity = '1';
        }, 300);
    };

    buttons.appendChild(applyBtn);
    buttons.appendChild(discardBtn);
    panel.appendChild(buttons);
    overlay.appendChild(panel);
    overlay.style.opacity = '1';
}

/**
 * Panel de revisión para modo Mejorar.
 * @param {string} originalText - Texto original
 * @param {string} improvedText - Texto mejorado
 * @param {object} stats - Estadísticas
 */
function renderImproveReviewPanel(originalText, improvedText, stats) {
    const overlay = getOrCreateOverlay();
    [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
    const panel = document.createElement('div');
    panel.style.cssText = 'margin-top:8px;';

    const title = document.createElement('div');
    title.style.cssText = 'color:#00e696;font-weight:600;font-size:11px;margin-bottom:6px;';
    title.textContent = '✓ Prompt mejorado';
    panel.appendChild(title);

    const comparison = document.createElement('div');
    comparison.style.cssText = 'font-size:10px;line-height:1.4;';

    const originalLabel = document.createElement('div');
    originalLabel.style.cssText = 'color:#6b8f71;margin-bottom:2px;';
    originalLabel.textContent = 'Original:';
    comparison.appendChild(originalLabel);

    const originalContent = document.createElement('div');
    originalContent.style.cssText = 'color:#9d9d9d;margin-bottom:6px;word-break:break-word;';
    originalContent.textContent = originalText.substring(0, 100) + (originalText.length > 100 ? '...' : '');
    comparison.appendChild(originalContent);

    const improvedLabel = document.createElement('div');
    improvedLabel.style.cssText = 'color:#00e696;margin-bottom:2px;';
    improvedLabel.textContent = 'Mejorado:';
    comparison.appendChild(improvedLabel);

    const despuesWrap = document.createElement('div');
    despuesWrap.style.cssText = 'background:rgba(0,230,150,0.05);border-radius:8px;padding:8px 10px;margin-bottom:6px;';
    const despuesLabel = document.createElement('div');
    despuesLabel.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#00e696;font-size:9px;font-weight:600;margin-bottom:4px;';
    despuesLabel.innerHTML = 'DESPUÉS <span id="iandes-edit-hint-improve" style="color:#6b8a78;font-size:8px;font-weight:400;">(haz clic en editar)</span>';
    despuesWrap.appendChild(despuesLabel);
    const despuesText = document.createElement('div');
    despuesText.id = 'iandes-improved-text';
    despuesText.style.cssText = 'color:#ffffff;font-size:10px;line-height:1.4;word-break:break-word;outline:none;';
    despuesText.textContent = improvedText;
    despuesText.contentEditable = false;
    despuesWrap.appendChild(despuesText);
    comparison.appendChild(despuesWrap);

    panel.appendChild(comparison);

    // Botón Editar
    const editBtn = document.createElement('button');
    editBtn.id = 'iandes-edit-btn-improve';
    editBtn.textContent = '✎ Editar';
    editBtn.style.cssText = 'width:100%;padding:4px 8px;background:transparent;color:#6b8a78;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:10px;pointer-events:auto;font-family:inherit;margin-bottom:6px;';
    editBtn.onclick = () => {
        despuesText.contentEditable = true;
        despuesText.style.background = 'rgba(255,255,255,0.05)';
        despuesText.style.borderRadius = '4px';
        despuesText.style.padding = '2px';
        despuesText.focus();
        editBtn.textContent = '✓ Listo';
        editBtn.style.color = '#00e696';
        editBtn.style.borderColor = '#00e696';
        const hint = document.getElementById('iandes-edit-hint-improve');
        if (hint) hint.textContent = '(editando…)';
    };
    panel.appendChild(editBtn);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Aceptar y reemplazar';
    applyBtn.style.cssText = 'flex:1;padding:5px 8px;background:#00e696;color:#000;border:none;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;pointer-events:auto;font-family:inherit;';
    applyBtn.onclick = () => { injectOptimizedPrompt(despuesText.textContent, stats, 'improve'); };

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Descartar';
    discardBtn.style.cssText = 'flex:1;padding:5px 8px;background:transparent;color:#6b8a78;border:1px solid #333;border-radius:6px;cursor:pointer;font-size:10px;pointer-events:auto;font-family:inherit;';
    discardBtn.onclick = () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
            [...overlay.childNodes].forEach(n => { if (n.id !== 'iandes-toggle-row' && n.id !== 'iandes-mode-buttons') n.remove(); });
            overlay.style.opacity = '1';
        }, 300);
    };

    buttons.appendChild(applyBtn);
    buttons.appendChild(discardBtn);
    panel.appendChild(buttons);
    overlay.appendChild(panel);
    overlay.style.opacity = '1';
}