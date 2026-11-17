/**
 * Zero-Dependency SVG Interactive Charts
 * Pure Vector, 100% offline, responsive, with tooltips and smooth transitions
 */

class DGICharts {
  constructor() {
    this.palette = [
      "#ffc500", // Dronacharya gold
      "#7c2d12", // Warm brown
      "#10b981", // Emerald
      "#f59e0b", // Amber
      "#ec4899", // Pink
      "#92400e", // Deep amber
      "#6b3049"  // Muted maroon
    ];
  }

  escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  /**
   * Render SVG Donut Chart for Categories
   */
  renderCategoryDonut(container, categoryData) {
    if (!container) return;
    const entries = Object.entries(categoryData);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);

    if (total === 0 || entries.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No book inventory data available.</div>`;
      return;
    }

    const size = 220;
    const strokeWidth = 26;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    let accumulatedAngle = 0;

    let paths = "";
    let legendHtml = '<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 14px;">';

    entries.forEach(([cat, count], index) => {
      const color = this.palette[index % this.palette.length];
      const ratio = count / total;
      const strokeDashoffset = circumference - (ratio * circumference);
      const rotation = accumulatedAngle * 360 - 90;

      paths += `
        <circle 
          cx="${size / 2}" 
          cy="${size / 2}" 
          r="${radius}" 
          fill="transparent" 
          stroke="${color}" 
          stroke-width="${strokeWidth}" 
          stroke-dasharray="${circumference}" 
          stroke-dashoffset="${strokeDashoffset}" 
          transform="rotate(${rotation} ${size / 2} ${size / 2})"
          style="transition: all 0.5s ease; cursor: pointer;"
          data-cat="${this.escapeHTML(cat)}"
          data-count="${count}"
          data-pct="${Math.round(ratio * 100)}%"
          class="donut-segment"
        />
      `;

      accumulatedAngle += ratio;

      legendHtml += `
        <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-secondary); background: var(--bg-secondary); padding: 3px 8px; border-radius: var(--radius-full); border: 1px solid var(--border-color);">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>
          <span>${this.escapeHTML(cat)}</span>
          <strong style="color: var(--text-primary); font-family: var(--font-mono);">${count}</strong>
        </div>
      `;
    });

    legendHtml += '</div>';

    const svg = `
      <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
        <div style="position: relative; width: ${size}px; height: ${size}px;">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            ${paths}
          </svg>
          <div id="donut-center-info" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; pointer-events: none;">
            <div style="font-size: 22px; font-weight: 800; font-family: var(--font-display); color: var(--text-primary);">${total}</div>
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 700;">Total Books</div>
          </div>
        </div>
        ${legendHtml}
      </div>
    `;

    container.innerHTML = svg;

    // Add hover interactivity
    const segments = container.querySelectorAll(".donut-segment");
    const centerInfo = container.querySelector("#donut-center-info");

    segments.forEach(seg => {
      seg.addEventListener("mouseenter", () => {
        const cat = seg.getAttribute("data-cat");
        const count = seg.getAttribute("data-count");
        const pct = seg.getAttribute("data-pct");
        seg.style.strokeWidth = `${strokeWidth + 4}px`;
        centerInfo.innerHTML = `
          <div style="font-size: 19px; font-weight: 800; color: var(--accent-primary);">${count}</div>
          <div style="font-size: 11px; font-weight: 700; color: var(--text-primary);">${this.escapeHTML(cat)} (${this.escapeHTML(pct)})</div>
        `;
      });
      seg.addEventListener("mouseleave", () => {
        seg.style.strokeWidth = `${strokeWidth}px`;
        centerInfo.innerHTML = `
          <div style="font-size: 22px; font-weight: 800; font-family: var(--font-display); color: var(--text-primary);">${total}</div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 700;">Total Books</div>
        `;
      });
    });
  }

  /**
   * Render SVG Grouped Bar Chart for Monthly Issues vs Returns
   */
  renderTrendBarChart(container, trendData) {
    if (!container) return;
    const months = Object.keys(trendData);
    if (months.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No transaction history yet.</div>`;
      return;
    }

    const width = 520;
    const height = 220;
    const paddingLeft = 40;
    const paddingBottom = 35;
    const paddingTop = 20;
    const paddingRight = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Find max value
    let maxVal = 4;
    months.forEach(m => {
      maxVal = Math.max(maxVal, trendData[m].issued, trendData[m].returned);
    });
    maxVal = Math.ceil(maxVal * 1.2); // headroom

    const groupWidth = chartWidth / months.length;
    const barWidth = Math.min(22, groupWidth * 0.35);

    let barsHtml = '';
    let gridLinesHtml = '';
    let labelsHtml = '';

    // Horizontal grid lines
    const gridTicks = 4;
    for (let i = 0; i <= gridTicks; i++) {
      const yVal = Math.round((maxVal / gridTicks) * i);
      const yPos = paddingTop + chartHeight - (yVal / maxVal) * chartHeight;
      gridLinesHtml += `
        <line x1="${paddingLeft}" y1="${yPos}" x2="${width - paddingRight}" y2="${yPos}" stroke="var(--border-color)" stroke-dasharray="3 3"/>
        <text x="${paddingLeft - 8}" y="${yPos + 4}" font-size="10" fill="var(--text-muted)" text-anchor="end" font-family="var(--font-mono)">${yVal}</text>
      `;
    }

    // Bars
    months.forEach((m, idx) => {
      const groupCenterX = paddingLeft + (idx * groupWidth) + (groupWidth / 2);
      const issuedVal = trendData[m].issued;
      const returnedVal = trendData[m].returned;

      const issuedHeight = (issuedVal / maxVal) * chartHeight;
      const returnedHeight = (returnedVal / maxVal) * chartHeight;

      const xIssued = groupCenterX - barWidth - 3;
      const yIssued = paddingTop + chartHeight - issuedHeight;

      const xReturned = groupCenterX + 3;
      const yReturned = paddingTop + chartHeight - returnedHeight;

      barsHtml += `
        <!-- Issued Bar -->
        <rect 
          x="${xIssued}" 
          y="${yIssued}" 
          width="${barWidth}" 
          height="${issuedHeight}" 
          fill="var(--accent-primary)" 
          rx="4"
          style="transition: height 0.6s cubic-bezier(0.16, 1, 0.3, 1);"
        >
          <title>${m} Issued: ${issuedVal}</title>
        </rect>
        ${issuedVal > 0 ? `<text x="${xIssued + barWidth / 2}" y="${yIssued - 4}" font-size="10" font-weight="700" fill="var(--accent-primary)" text-anchor="middle">${issuedVal}</text>` : ''}

        <!-- Returned Bar -->
        <rect 
          x="${xReturned}" 
          y="${yReturned}" 
          width="${barWidth}" 
          height="${returnedHeight}" 
          fill="var(--success)" 
          rx="4"
          style="transition: height 0.6s cubic-bezier(0.16, 1, 0.3, 1);"
        >
          <title>${m} Returned: ${returnedVal}</title>
        </rect>
        ${returnedVal > 0 ? `<text x="${xReturned + barWidth / 2}" y="${yReturned - 4}" font-size="10" font-weight="700" fill="var(--success)" text-anchor="middle">${returnedVal}</text>` : ''}
      `;

      labelsHtml += `
        <text x="${groupCenterX}" y="${height - 10}" font-size="11.5" font-weight="600" fill="var(--text-secondary)" text-anchor="middle">${m}</text>
      `;
    });

    const legend = `
      <div style="display: flex; gap: 16px; justify-content: flex-end; margin-bottom: 8px; font-size: 12px; font-weight: 600;">
        <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--accent-primary);"></span> Books Issued
        </span>
        <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary);">
          <span style="width: 10px; height: 10px; border-radius: 2px; background: var(--success);"></span> Books Returned
        </span>
      </div>
    `;

    const svg = `
      <div style="width: 100%;">
        ${legend}
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; overflow: visible;">
          ${gridLinesHtml}
          ${barsHtml}
          ${labelsHtml}
        </svg>
      </div>
    `;

    container.innerHTML = svg;
  }
}

window.dgiCharts = new DGICharts();
