/**
 * PRISM Demo Mode — Auto-pilot for live customer presentations
 * Activated via ?demo=true in the URL
 * Runs after the main app initialises (DOMContentLoaded + 800ms delay)
 */
(function () {
  'use strict';

  const DEMO_ACTIVE = new URLSearchParams(window.location.search).get('demo') === 'true';
  if (!DEMO_ACTIVE) return;

  // ── Config ───────────────────────────────────────────────────────────────────
  const OPENING_QUESTION =
    'Which transformers are at highest failure risk in the next 48 hours, and what specific sensor anomalies are driving the risk scores?';

  const HIGHLIGHT_COLOR = 'rgba(217,119,6,0.18)';
  const PULSE_BORDER = '2px solid rgba(217,119,6,0.7)';

  // ── Utilities ─────────────────────────────────────────────────────────────────
  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function pulse(el, duration) {
    if (!el) return;
    var prev = el.style.cssText;
    el.style.transition = 'box-shadow 0.4s ease';
    el.style.boxShadow = '0 0 0 4px rgba(217,119,6,0.5), 0 0 20px rgba(217,119,6,0.3)';
    el.style.borderRadius = el.style.borderRadius || '8px';
    setTimeout(function () {
      if (el) el.style.cssText = prev;
    }, duration || 2000);
  }

  function injectDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:50%', 'transform:translateX(-50%)',
      'background:linear-gradient(90deg,#B45309,#D97706)', 'color:#fff',
      'font-size:11px', 'font-weight:700', 'padding:3px 16px',
      'border-radius:0 0 8px 8px', 'z-index:9999',
      'letter-spacing:0.08em', 'pointer-events:none',
      'box-shadow:0 2px 12px rgba(180,83,9,0.5)'
    ].join(';');
    banner.textContent = '⚡ DEMO MODE — SAFARICOM ETHIOPIA LIVE PRESENTATION';
    document.body.appendChild(banner);
  }

  function injectDemoStyles() {
    if (document.getElementById('demo-mode-styles')) return;
    var style = document.createElement('style');
    style.id = 'demo-mode-styles';
    style.textContent = [
      '@keyframes demo-pulse-ring {',
      '  0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,0.6); }',
      '  50% { box-shadow: 0 0 0 8px rgba(217,119,6,0); }',
      '}',
      '.demo-highlight {',
      '  animation: demo-pulse-ring 2s ease infinite !important;',
      '  border: 1px solid rgba(217,119,6,0.6) !important;',
      '  position: relative;',
      '}',
      '.demo-highlight::after {',
      '  content: "DEMO";',
      '  position: absolute;',
      '  top: -8px;',
      '  right: 8px;',
      '  font-size: 9px;',
      '  font-weight: 700;',
      '  background: #D97706;',
      '  color: #fff;',
      '  padding: 1px 5px;',
      '  border-radius: 3px;',
      '  letter-spacing: 0.05em;',
      '}',
      '.demo-tooltip {',
      '  position: fixed;',
      '  background: linear-gradient(135deg, #1F2937, #111827);',
      '  border: 1px solid rgba(217,119,6,0.5);',
      '  border-radius: 10px;',
      '  padding: 12px 16px;',
      '  font-size: 12px;',
      '  color: #F9FAFB;',
      '  max-width: 300px;',
      '  z-index: 9000;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5);',
      '  pointer-events: none;',
      '  transition: opacity 0.3s ease;',
      '}',
      '.demo-tooltip .demo-tip-label {',
      '  font-size: 10px;',
      '  font-weight: 700;',
      '  color: #D97706;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.08em;',
      '  margin-bottom: 4px;',
      '}',
      '.demo-counter-bar {',
      '  position: fixed;',
      '  bottom: 16px;',
      '  left: 50%;',
      '  transform: translateX(-50%);',
      '  background: rgba(31,41,55,0.95);',
      '  border: 1px solid rgba(217,119,6,0.4);',
      '  border-radius: 30px;',
      '  padding: 8px 20px;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 12px;',
      '  z-index: 9000;',
      '  backdrop-filter: blur(8px);',
      '  font-size: 12px;',
      '  color: #9CA3AF;',
      '  box-shadow: 0 4px 24px rgba(0,0,0,0.4);',
      '}',
      '.demo-counter-bar span.step-indicator {',
      '  color: #D97706;',
      '  font-weight: 700;',
      '  font-size: 11px;',
      '}',
      '.demo-counter-bar .demo-nav-btn {',
      '  background: rgba(217,119,6,0.2);',
      '  border: 1px solid rgba(217,119,6,0.4);',
      '  color: #D97706;',
      '  border-radius: 20px;',
      '  padding: 3px 12px;',
      '  font-size: 11px;',
      '  font-weight: 600;',
      '  cursor: pointer;',
      '  transition: all 0.15s;',
      '}',
      '.demo-counter-bar .demo-nav-btn:hover {',
      '  background: rgba(217,119,6,0.35);',
      '}',
      '.demo-counter-bar .demo-exit-btn {',
      '  background: rgba(239,68,68,0.15);',
      '  border: 1px solid rgba(239,68,68,0.3);',
      '  color: #FCA5A5;',
      '  border-radius: 20px;',
      '  padding: 3px 10px;',
      '  font-size: 11px;',
      '  font-weight: 600;',
      '  cursor: pointer;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Demo Tooltip ──────────────────────────────────────────────────────────────
  var tooltipEl = null;
  function showTooltip(x, y, label, text) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'demo-tooltip';
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.innerHTML = '<div class="demo-tip-label">' + label + '</div>' + text;
    tooltipEl.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    tooltipEl.style.top = (y + 12) + 'px';
    tooltipEl.style.opacity = '1';
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.opacity = '0';
  }

  // ── Demo Navigation Bar ───────────────────────────────────────────────────────
  var demoState = { step: 0, total: 5 };
  var demoSteps = [
    { label: 'AI Risk Assessment', view: 'ai', tip: 'The AI assistant queries live sensor data across all 500 transformer sites to surface the highest-risk assets in real time.' },
    { label: 'Fleet Dashboard', view: 'dashboard', tip: 'Command-level view: active alerts, fleet health score, subscribers at risk, and cumulative financial impact — refreshing every 5 seconds.' },
    { label: 'GIS Map', view: 'map', tip: 'Geographic risk view: 500 transformer markers colour-coded by health status across 5 Ethiopian regions. Red = critical, orange = high-risk.' },
    { label: '72-Hour Forecast', view: 'analytics', tip: 'Predictive trajectory charts showing winding temperature forecasts and anomaly overlays — the 48–72 hour early warning window.' },
    { label: 'Fault Audit Trail', view: 'explorer', tip: 'Full audit trail: fault history, maintenance records, sensor readings — all exportable for ECA Proclamation No. 1148/2019 compliance.' },
  ];

  function buildNavBar() {
    var bar = document.createElement('div');
    bar.className = 'demo-counter-bar';
    bar.id = 'demo-nav-bar';

    var leftBtn = document.createElement('button');
    leftBtn.className = 'demo-nav-btn';
    leftBtn.textContent = '← Prev';
    leftBtn.onclick = function () { navigateDemo(-1); };

    var stepLabel = document.createElement('span');
    stepLabel.className = 'step-indicator';
    stepLabel.id = 'demo-step-label';
    stepLabel.textContent = 'Step 1 / 5';

    var stepName = document.createElement('span');
    stepName.id = 'demo-step-name';
    stepName.textContent = demoSteps[0].label;

    var rightBtn = document.createElement('button');
    rightBtn.className = 'demo-nav-btn';
    rightBtn.textContent = 'Next →';
    rightBtn.onclick = function () { navigateDemo(1); };

    var exitBtn = document.createElement('button');
    exitBtn.className = 'demo-exit-btn';
    exitBtn.textContent = '✕ Exit';
    exitBtn.onclick = exitDemo;

    bar.appendChild(leftBtn);
    bar.appendChild(stepLabel);
    bar.appendChild(stepName);
    bar.appendChild(rightBtn);
    bar.appendChild(exitBtn);
    document.body.appendChild(bar);
  }

  function updateNavBar() {
    var label = document.getElementById('demo-step-label');
    var name = document.getElementById('demo-step-name');
    if (label) label.textContent = 'Step ' + (demoState.step + 1) + ' / ' + demoSteps.length;
    if (name) name.textContent = demoSteps[demoState.step].label;
  }

  function navigateDemo(direction) {
    var next = demoState.step + direction;
    if (next < 0 || next >= demoSteps.length) return;
    demoState.step = next;
    var step = demoSteps[demoState.step];
    if (window.showView) showView(step.view);
    updateNavBar();
    triggerStepActions(demoState.step);
  }

  function exitDemo() {
    var url = new URL(window.location.href);
    url.searchParams.delete('demo');
    window.location.href = url.toString();
  }

  // ── Step-Specific Actions ─────────────────────────────────────────────────────
  function triggerStepActions(stepIndex) {
    if (stepIndex === 0) activateAIStep();
    if (stepIndex === 1) activateDashboardStep();
    if (stepIndex === 2) activateMapStep();
    if (stepIndex === 3) activateAnalyticsStep();
    if (stepIndex === 4) activateExplorerStep();
  }

  function activateAIStep() {
    // Highlight AI chat input
    var chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.focus();
      pulse(chatInput, 2500);
    }
    // Highlight the first suggested prompt
    var firstPill = document.querySelector('.prompt-pill');
    if (firstPill) {
      setTimeout(function () { pulse(firstPill, 2000); }, 400);
    }
  }

  function activateDashboardStep() {
    // Highlight KPI cards with a cascade effect
    var kpis = document.querySelectorAll('.kpi-card');
    kpis.forEach(function (kpi, i) {
      setTimeout(function () { pulse(kpi, 1800); }, i * 200);
    });
  }

  function activateMapStep() {
    // Pulse the map container
    var mapContainer = document.getElementById('map-container');
    if (mapContainer) setTimeout(function () { pulse(mapContainer, 2000); }, 500);
  }

  function activateAnalyticsStep() {
    // Pulse the analytics view panel cards
    var panels = document.querySelectorAll('#view-analytics .panel-card');
    panels.forEach(function (p, i) {
      setTimeout(function () { pulse(p, 1800); }, i * 250);
    });
  }

  function activateExplorerStep() {
    // Pre-fill explorer search with "Bole" and highlight
    var searchInputs = document.querySelectorAll('.search-input');
    searchInputs.forEach(function (el) {
      if (el.closest('#view-explorer') || !el.closest('[style*="display: none"]')) {
        el.value = 'Bole';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        pulse(el, 2000);
      }
    });
    // Click the fault events tab if available
    var faultTab = document.querySelector('[data-entity="faults"]');
    if (faultTab) {
      setTimeout(function () { faultTab.click(); }, 600);
    }
  }

  // ── Pre-fill AI Chat with Demo Question ───────────────────────────────────────
  function prefillAIChat() {
    var chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    // Clear existing content
    chatInput.value = '';

    // Type out the question character by character for dramatic effect
    var chars = OPENING_QUESTION.split('');
    var i = 0;
    function typeNext() {
      if (i >= chars.length) {
        // Add a visual cue to send
        var sendBtn = document.querySelector('.chat-send-btn');
        if (sendBtn) pulse(sendBtn, 3000);
        return;
      }
      chatInput.value += chars[i];
      i++;
      setTimeout(typeNext, 18);
    }

    // Start typing after a short delay so the view is settled
    setTimeout(typeNext, 600);
  }

  // ── Inject Demo Suggested Prompts ────────────────────────────────────────────
  function injectDemoPrompts() {
    var container = document.getElementById('suggested-prompts');
    if (!container) return;

    var demoPrompts = [
      { emoji: '🔴', text: 'Which transformers are at highest failure risk in the next 48 hours, and what specific sensor anomalies are driving the risk scores?' },
      { emoji: '💰', text: 'What is the 5-year financial impact of deploying PRISM across all 500 monitored sites?' },
      { emoji: '🌡', text: 'Show me the thermal degradation trend on the Bole Microwave Link Site and explain what the LSTM model detected.' },
      { emoji: '📊', text: 'Summarise the pre-PRISM vs post-PRISM fault detection delay improvement and quantify the cost savings.' },
      { emoji: '🛡', text: 'How does on-premises edge processing satisfy ECA Proclamation No. 1148/2019 data residency requirements?' },
      { emoji: '⚡', text: 'Which sites in the Oromia corridor have oil moisture readings above the IEC 60422 caution threshold of 25 ppm?' },
      { emoji: '👷', text: 'How many field engineers are on-call right now, and which sites should they prioritise?' },
      { emoji: '📋', text: 'Generate an executive summary of today\'s fleet health status for a Vodacom Group board briefing.' },
    ];

    // Clear existing and inject demo-optimised prompts
    container.innerHTML = '';
    demoPrompts.forEach(function (p) {
      var pill = document.createElement('div');
      pill.className = 'prompt-pill';
      pill.setAttribute('onclick', 'sendPrompt(this)');
      pill.innerHTML = p.emoji + ' ' + p.text;
      container.appendChild(pill);
    });
  }

  // ── Auto-highlight critical KPI cards after dashboard loads ──────────────────
  function animateDashboardKpis() {
    var kpis = document.querySelectorAll('.kpi-card');
    kpis.forEach(function (kpi, i) {
      setTimeout(function () {
        kpi.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
        kpi.style.transform = 'translateY(-3px)';
        kpi.style.boxShadow = '0 12px 32px rgba(0,0,0,0.4)';
        setTimeout(function () {
          kpi.style.transform = '';
          kpi.style.boxShadow = '';
        }, 600);
      }, i * 150 + 300);
    });
  }

  // ── Number counter animation ──────────────────────────────────────────────────
  function animateCounters() {
    var kpiValues = document.querySelectorAll('.kpi-value');
    kpiValues.forEach(function (el) {
      var raw = el.textContent.replace(/[^0-9.]/g, '');
      var target = parseFloat(raw);
      if (isNaN(target) || target === 0) return;

      var start = 0;
      var duration = 1000;
      var startTime = null;
      var prefix = el.textContent.replace(/[0-9.,]+.*$/, '');
      var suffix = el.textContent.replace(/^[^0-9]*[0-9.,]+/, '');

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var value = Math.round(start + (target - start) * eased);
        el.textContent = prefix + value.toLocaleString() + suffix;
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  // ── Real-time pulse on critical alert badge ───────────────────────────────────
  function pulseAlertBadge() {
    var badge = document.getElementById('notif-count');
    if (!badge) return;
    badge.style.animation = 'none';
    badge.style.cssText += ';animation: pulse-dot 1.5s ease infinite !important;';
  }

  // ── Observer: react when views become visible ─────────────────────────────────
  function watchViewChanges() {
    var mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    var observer = new MutationObserver(function () {
      var activeView = document.querySelector('.view.active');
      if (!activeView) return;
      var viewId = activeView.id || '';

      if (viewId === 'view-dashboard') {
        setTimeout(animateDashboardKpis, 300);
        setTimeout(animateCounters, 400);
      }
    });

    observer.observe(mainContent, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  // ── Inject demo watermark on each main view ───────────────────────────────────
  function addViewWatermarks() {
    var views = ['ai', 'dashboard', 'explorer', 'analytics', 'map'];
    views.forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (!el) return;
      var mark = document.createElement('div');
      mark.style.cssText = [
        'position:absolute', 'bottom:12px', 'right:16px',
        'font-size:10px', 'color:rgba(217,119,6,0.35)',
        'font-weight:700', 'letter-spacing:0.1em',
        'pointer-events:none', 'z-index:1', 'user-select:none'
      ].join(';');
      mark.textContent = 'PRISM DEMO — SAFARICOM ETHIOPIA';
      el.style.position = el.style.position || 'relative';
      el.appendChild(mark);
    });
  }

  // ── Main Entry Point ──────────────────────────────────────────────────────────
  function initDemoMode() {
    injectDemoStyles();
    injectDemoBanner();
    buildNavBar();
    watchViewChanges();

    // Give main app time to initialise
    wait(900).then(function () {
      // Inject demo-optimised prompts
      injectDemoPrompts();

      // Pre-fill chat question with typewriter effect
      prefillAIChat();

      // Pulse notification badge
      pulseAlertBadge();

      // Animate KPI counters if dashboard visible
      var dash = document.getElementById('view-dashboard');
      if (dash && dash.classList.contains('active')) {
        setTimeout(animateDashboardKpis, 200);
        setTimeout(animateCounters, 300);
      }

      // Update nav bar to reflect step 0
      updateNavBar();

      // Trigger step 0 actions
      triggerStepActions(0);

      return wait(400);
    }).then(function () {
      addViewWatermarks();
    });
  }

  // Attach to DOMContentLoaded or run immediately if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDemoMode);
  } else {
    initDemoMode();
  }

  // Expose demo navigation globally for console use during live demos
  window.demoNav = {
    next: function () { navigateDemo(1); },
    prev: function () { navigateDemo(-1); },
    go: function (n) { demoState.step = n - 1; navigateDemo(1); },
    exit: exitDemo
  };

})();
