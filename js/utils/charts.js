/**
 * Chart.js wrapper: brand theming, RTL-aware defaults and lifecycle handling.
 * Charts re-render themselves when the theme changes.
 */

const registry = new Map();

function cssVar(name, fallback = '') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function palette() {
  return {
    brand: cssVar('--yellow', '#FFC928'),
    success: cssVar('--success', '#34D399'),
    danger: cssVar('--danger', '#F87171'),
    info: cssVar('--info', '#60A5FA'),
    purple: cssVar('--purple', '#A78BFA'),
    warning: cssVar('--warning', '#FBBF24'),
    gray: cssVar('--gray', '#7F8998'),
    grid: cssVar('--border-soft', 'rgba(255,255,255,0.08)'),
    text: cssVar('--text-muted', '#7F8998'),
    surface: cssVar('--bg-surface', '#102943')
  };
}

export function series() {
  const p = palette();
  return [p.brand, p.info, p.purple, p.success, p.warning, p.danger, p.gray];
}

function baseOptions() {
  const p = palette();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: {
        display: false,
        labels: {
          color: p.text,
          font: { family: 'DIN, "DIN Next Arabic", Arial, sans-serif', size: 12 },
          usePointStyle: true,
          boxWidth: 8
        }
      },
      tooltip: {
        backgroundColor: cssVar('--bg-elevated', '#14314e'),
        titleColor: cssVar('--text-primary', '#F8FAFC'),
        bodyColor: p.text,
        borderColor: cssVar('--border', '#263B52'),
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        rtl: true,
        textDirection: 'rtl',
        titleFont: { family: 'DIN, "DIN Next Arabic", Arial, sans-serif', weight: '700' },
        bodyFont: { family: 'DIN, "DIN Next Arabic", Arial, sans-serif' }
      }
    },
    scales: {
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: p.text, font: { family: 'DIN, Arial, sans-serif', size: 11 } }
      },
      y: {
        beginAtZero: true,
        grid: { color: p.grid, drawBorder: false },
        ticks: { color: p.text, precision: 0, font: { family: 'DIN, Arial, sans-serif', size: 11 } }
      }
    }
  };
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(target[key] || {}, value)
      : value;
  }
  return out;
}

/**
 * Create (or replace) a chart bound to a canvas id.
 * Returns the Chart instance, or null when Chart.js is unavailable.
 */
export function makeChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (!window.Chart) { console.warn('[luma] Chart.js not loaded'); return null; }

  registry.get(canvasId)?.destroy();

  const merged = {
    ...config,
    options: deepMerge(baseOptions(), config.options || {})
  };
  if (config.type === 'doughnut' || config.type === 'pie') {
    delete merged.options.scales;
  }

  const chart = new window.Chart(canvas.getContext('2d'), merged);
  registry.set(canvasId, chart);
  return chart;
}

export function destroyChart(canvasId) {
  registry.get(canvasId)?.destroy();
  registry.delete(canvasId);
}

export function destroyAllCharts() {
  registry.forEach((chart) => chart.destroy());
  registry.clear();
}

/* Re-theme every live chart when the user flips dark/light. */
window.addEventListener('luma:theme', () => {
  registry.forEach((chart) => {
    const merged = deepMerge(baseOptions(), {});
    chart.options = deepMerge(chart.options, merged);
    chart.update('none');
  });
});

/* ---------------------------------------------------------- presets --- */

export function lineChart(canvasId, labels, datasets) {
  const p = palette();
  return makeChart(canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        tension: 0.38,
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: d.color || series()[i],
        borderColor: d.color || series()[i],
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea } = ctx.chart;
          if (!chartArea) return 'transparent';
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          const color = d.color || series()[i];
          gradient.addColorStop(0, `${color}44`);
          gradient.addColorStop(1, `${color}00`);
          return gradient;
        },
        fill: d.fill !== false,
        ...d
      }))
    },
    options: { plugins: { legend: { display: datasets.length > 1 } } }
  });
}

export function barChart(canvasId, labels, datasets, { horizontal = false, stacked = false } = {}) {
  return makeChart(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        backgroundColor: d.color || series()[i],
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.66,
        categoryPercentage: 0.7,
        ...d
      }))
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: datasets.length > 1 } },
      scales: { x: { stacked }, y: { stacked } }
    }
  });
}

export function doughnutChart(canvasId, labels, values, colors) {
  return makeChart(canvasId, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors || series(),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      cutout: '68%',
      plugins: { legend: { display: true, position: 'bottom' } }
    }
  });
}
