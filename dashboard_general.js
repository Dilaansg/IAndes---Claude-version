// Dashboard General — lee consumo semanal desde chrome.storage.local (iandesUsageDailyV1)
// y actualiza el HTML con valores reales.

const USAGE_STORAGE_KEY = "iandesUsageDailyV1";

function formatLocalDayKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function clampToFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function getLast7DayKeys(nowTs) {
    const keys = [];
    const d = new Date(nowTs);
    d.setHours(12, 0, 0, 0); // mediodía para evitar edge-cases de DST
    for (let i = 6; i >= 0; i--) {
        const t = d.getTime() - i * 24 * 60 * 60 * 1000;
        keys.push(formatLocalDayKey(t));
    }
    return keys;
}

function shortDowLabel(dayKey) {
    const dt = new Date(`${dayKey}T12:00:00`);
    const idx = dt.getDay(); // 0 Dom .. 6 Sáb
    return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][idx] || dayKey;
}

function formatNumberCompact(n) {
    const num = clampToFiniteNumber(n, 0);
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(num);
}

function formatLitersFromMl(ml) {
    const liters = clampToFiniteNumber(ml, 0) / 1000;
    if (liters < 1) {
        return { value: new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(liters * 1000)), unit: "ml" };
    }
    return { value: new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(liters), unit: "L" };
}

function formatKgFromG(g) {
    const kg = clampToFiniteNumber(g, 0) / 1000;
    if (kg < 1) {
        return { value: new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(clampToFiniteNumber(g, 0))), unit: "g" };
    }
    return { value: new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(kg), unit: "kg" };
}

function setMetric(elId, valueText, unitText) {
    const el = document.getElementById(elId);
    if (!el) return;
    const valueEl = el.querySelector(".metric-value");
    const unitEl = el.querySelector(".metric-unit");
    if (valueEl) valueEl.textContent = valueText;
    if (unitEl) unitEl.textContent = unitText;
}

function setFact(text) {
    const el = document.getElementById("fun-fact");
    if (!el) return;
    el.textContent = text;
}

async function loadUsage() {
    return await chrome.storage.local.get([USAGE_STORAGE_KEY]);
}

function computeWeek(usageDays, dayKeys) {
    const daily = dayKeys.map((k) => {
        const d = usageDays?.[k] || {};
        return {
            key: k,
            tokens: clampToFiniteNumber(d.tokens, 0),
            water_ml: clampToFiniteNumber(d.water_ml, 0),
            co2_g: clampToFiniteNumber(d.co2_g, 0),
        };
    });

    const totals = daily.reduce((acc, d) => {
        acc.tokens += d.tokens;
        acc.water_ml += d.water_ml;
        acc.co2_g += d.co2_g;
        return acc;
    }, { tokens: 0, water_ml: 0, co2_g: 0 });

    return { daily, totals };
}

function renderWeeklyTotals(totals) {
    const water = formatLitersFromMl(totals.water_ml);
    const co2 = formatKgFromG(totals.co2_g);
    setMetric("metric-water", water.value, water.unit);
    setMetric("metric-co2", co2.value, co2.unit);
    setMetric("metric-tokens", formatNumberCompact(totals.tokens), "tokens");

    if (totals.tokens <= 0) {
        setFact("Aún no hay datos esta semana. Escribe un prompt en ChatGPT/Claude/Gemini/Copilot para comenzar a medir.");
        return;
    }

    // Dato simple y verificable: promedio diario en 7 días.
    const avgTokens = Math.round(totals.tokens / 7);
    setFact(`Promedio diario (7 días): ${formatNumberCompact(avgTokens)} tokens.`);
}

function renderChart(daily) {
    const groups = Array.from(document.querySelectorAll(".bar-group"));
    if (groups.length === 0) return;

    const maxWater = Math.max(1, ...daily.map(d => d.water_ml));
    const maxCo2 = Math.max(1, ...daily.map(d => d.co2_g));

    for (let i = 0; i < Math.min(groups.length, daily.length); i++) {
        const day = daily[i];
        const group = groups[i];
        const waterBar = group.querySelector(".bar.water");
        const co2Bar = group.querySelector(".bar.carbon");
        const label = group.querySelector(".dow");

        const waterPct = Math.round((day.water_ml / maxWater) * 100);
        const co2Pct = Math.round((day.co2_g / maxCo2) * 100);

        if (waterBar) waterBar.style.height = `${waterPct}%`;
        if (co2Bar) co2Bar.style.height = `${co2Pct}%`;
        if (label) label.textContent = shortDowLabel(day.key);

        group.setAttribute("title", `${day.key}\nAgua: ${formatLitersFromMl(day.water_ml).value}${formatLitersFromMl(day.water_ml).unit}\nCO₂: ${formatKgFromG(day.co2_g).value}${formatKgFromG(day.co2_g).unit}\nTokens: ${formatNumberCompact(day.tokens)}`);
    }
}

async function main() {
    const now = Date.now();
    const dayKeys = getLast7DayKeys(now);

    const stored = await loadUsage();
    const usage = stored?.[USAGE_STORAGE_KEY];
    const usageDays = usage?.days || {};

    const { daily, totals } = computeWeek(usageDays, dayKeys);
    renderWeeklyTotals(totals);
    renderChart(daily);
}

document.addEventListener("DOMContentLoaded", () => {
    main().catch(() => {});
});

