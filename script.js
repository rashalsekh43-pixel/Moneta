(() => {
  "use strict";

  const EXPENSE_CATEGORIES = ["Food", "Shopping", "Transportation", "Entertainment", "Education", "Bills & Utilities", "Healthcare", "Other"];
  const INCOME_CATEGORIES = ["Salary", "Freelancing", "Business", "Gift", "Other"];
  const CATEGORY_COLORS = ["#8b7ee8", "#e7a54a", "#55a8ce", "#e87970", "#6db68e", "#d27db1", "#7891c8", "#a4adbb"];
  const CURRENCIES = {
    INR: { symbol: "₹", locale: "en-IN" },
    USD: { symbol: "$", locale: "en-US" },
    EUR: { symbol: "€", locale: "de-DE" },
    GBP: { symbol: "£", locale: "en-GB" }
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const now = new Date();
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = monthKey(now);
  let state = { transactions: [], budgetsByMonth: {}, currency: "INR", theme: "light" };
  let currentUser = null;
  let isGuest = false;
  let dashboardMonth = currentMonth;
  let reportMonth = currentMonth;
  let activeType = "expense";
  let pendingConfirm = null;
  let settingsWriteQueue = Promise.resolve();
  const charts = {};

  function validNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function isValidTransaction(item) {
    const categories = item && item.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const [year, month, day] = item && typeof item.date === "string" ? item.date.split("-").map(Number) : [];
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(item && item.date || "") &&
      parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day;
    return item && typeof item === "object" &&
      typeof item.id === "string" && item.id.length > 0 &&
      typeof item.title === "string" && item.title.trim().length > 0 &&
      Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 &&
      (item.type === "income" || item.type === "expense") &&
      typeof item.category === "string" && categories.includes(item.category) &&
      validDate;
  }

  function budgetsFor(month) {
    return state.budgetsByMonth[month] || { monthly: 0, categories: {} };
  }

  async function api(path, options = {}) {
    const requestOptions = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: { "accept": "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    };
    const response = await fetch(path, requestOptions);
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      if (response.ok) throw new Error("The server returned an invalid response.");
    }
    if (!response.ok) {
      if (response.status === 401 && currentUser && options.auth !== false) handleSessionExpired();
      const requestError = new Error(payload.error || `Request failed (${response.status}).`);
      requestError.status = response.status;
      throw requestError;
    }
    return payload;
  }

  function saveSettings() {
    if (isGuest) return Promise.resolve();
    const write = settingsWriteQueue.catch(() => {}).then(() => api("/api/settings", {
      method: "PUT",
      body: { currency: state.currency, theme: state.theme }
    }));
    settingsWriteQueue = write;
    return write;
  }

  function handleSessionExpired() {
    currentUser = null;
    isGuest = false;
    document.body.classList.remove("guest-mode");
    state = { transactions: [], budgetsByMonth: {}, currency: "INR", theme: "light" };
    $("#app-shell").hidden = true;
    $("#auth-screen").hidden = false;
    $("#guest-notice").hidden = true;
    $("#logout-button").innerHTML = `${icon("log-out")}<span>Sign out</span>`;
    setTheme("light", false);
    $("#auth-heading").textContent = "Sign in again";
    $("#auth-subtitle").textContent = "Your session has expired. Sign in to continue.";
    setAuthView("login");
  }

  function setAuthView(view) {
    const registering = view === "register";
    $("#login-form").hidden = registering;
    $("#register-form").hidden = !registering;
    $("#auth-heading").textContent = registering ? "Create your account" : "Welcome back";
    $("#auth-subtitle").textContent = registering ? "Your private finance space starts here." : "Sign in to your private finance dashboard.";
    $("#login-error").textContent = "";
    $("#register-error").textContent = "";
  }

  async function showAuthenticatedApp(user) {
    isGuest = false;
    document.body.classList.remove("guest-mode");
    currentUser = user;
    const [transactionData, budgetData, settingData] = await Promise.all([
      api("/api/transactions"),
      api("/api/budgets"),
      api("/api/settings")
    ]);
    state.transactions = transactionData.transactions;
    state.budgetsByMonth = {};
    budgetData.budgets.forEach((budget) => {
      const monthBudgets = state.budgetsByMonth[budget.month] || { monthly: 0, categories: {} };
      if (budget.category) monthBudgets.categories[budget.category] = budget.amount;
      else monthBudgets.monthly = budget.amount;
      state.budgetsByMonth[budget.month] = monthBudgets;
    });
    state.currency = CURRENCIES[settingData.settings.currency] ? settingData.settings.currency : "INR";
    state.theme = settingData.settings.theme === "dark" ? "dark" : "light";
    $("#sidebar-user-name").textContent = user.fullName;
    $("#sidebar-user-email").textContent = user.email;
    $("#profile-name").value = user.fullName;
    $("#profile-email").value = user.email;
    $("#guest-notice").hidden = true;
    $("#logout-button").innerHTML = `${icon("log-out")}<span>Sign out</span>`;
    $("#auth-screen").hidden = true;
    $("#app-shell").hidden = false;
    setTheme(state.theme, false);
    updateCurrencyControls();
    renderAll();
    refreshIcons();
  }

  function showGuestApp() {
    currentUser = null;
    isGuest = true;
    document.body.classList.add("guest-mode");
    state = { transactions: [], budgetsByMonth: {}, currency: "INR", theme: "light" };
    dashboardMonth = currentMonth;
    reportMonth = currentMonth;
    $("#sidebar-user-name").textContent = "Guest";
    $("#sidebar-user-email").textContent = "Temporary session";
    $("#logout-button").innerHTML = `${icon("log-out")}<span>Exit guest</span>`;
    $("#guest-notice").hidden = false;
    $("#auth-screen").hidden = true;
    $("#app-shell").hidden = false;
    setPage("dashboard");
    setTheme("light", false);
    updateCurrencyControls();
    renderAll();
    refreshIcons();
  }

  function exitGuestMode() {
    isGuest = false;
    document.body.classList.remove("guest-mode");
    currentUser = null;
    state = { transactions: [], budgetsByMonth: {}, currency: "INR", theme: "light" };
    dashboardMonth = currentMonth;
    reportMonth = currentMonth;
    $("#guest-notice").hidden = true;
    $("#app-shell").hidden = true;
    $("#auth-screen").hidden = false;
    $("#logout-button").innerHTML = `${icon("log-out")}<span>Sign out</span>`;
    setTheme("light", false);
    setPage("dashboard");
    setAuthView("login");
    renderAll();
    refreshIcons();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function categoryColor(category) {
    const pool = category === "Income" ? "#20a879" : CATEGORY_COLORS;
    if (typeof pool === "string") return pool;
    let hash = 0;
    for (let index = 0; index < category.length; index += 1) hash = (hash * 31 + category.charCodeAt(index)) | 0;
    return pool[Math.abs(hash) % pool.length];
  }

  function formatMoney(value, options = {}) {
    const currency = CURRENCIES[state.currency] ? state.currency : "INR";
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    try {
      return new Intl.NumberFormat(CURRENCIES[currency].locale, {
        style: "currency", currency, maximumFractionDigits: 2,
        minimumFractionDigits: 0, ...options
      }).format(amount);
    } catch (error) {
      console.error("Could not format currency:", error);
      return `${CURRENCIES[currency].symbol}${amount.toFixed(2)}`;
    }
  }

  function formatDate(dateString, options = { day: "numeric", month: "short", year: "numeric" }) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }

  function monthDate(value) {
    const [year, month] = value.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }

  function monthLabel(value, options = { month: "long", year: "numeric" }) {
    return new Intl.DateTimeFormat(undefined, options).format(monthDate(value));
  }

  function isValidMonthKey(value) {
    if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    return year >= 1900 && year <= 9999;
  }

  function isValidBackupBudget(budget) {
    if (!budget || typeof budget !== "object" || Array.isArray(budget)) return false;
    if (budget.monthly !== undefined && (typeof budget.monthly !== "number" || !Number.isFinite(budget.monthly) || budget.monthly < 0)) return false;
    if (budget.categories === undefined) return true;
    if (!budget.categories || typeof budget.categories !== "object" || Array.isArray(budget.categories)) return false;
    return Object.entries(budget.categories).every(([category, amount]) =>
      EXPENSE_CATEGORIES.includes(category) && typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
  }

  function getMonthTransactions(month, type) {
    return state.transactions.filter((item) => item.date.slice(0, 7) === month && (!type || item.type === type));
  }

  function sum(items) {
    return items.reduce((total, item) => total + Number(item.amount), 0);
  }

  function icon(name, className = "") {
    return `<i data-lucide="${name}"${className ? ` class="${className}"` : ""}></i>`;
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  function toast(message, type = "success") {
    const region = $("#toast-region");
    const node = document.createElement("div");
    node.className = `toast${type === "error" ? " error" : ""}`;
    node.innerHTML = `${icon(type === "error" ? "circle-alert" : "circle-check")}<span>${escapeHtml(message)}</span>`;
    region.appendChild(node);
    refreshIcons();
    window.setTimeout(() => node.remove(), 3400);
  }

  function categoryOptions(type, selected = "") {
    const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return categories.map((category) => `<option value="${escapeHtml(category)}"${category === selected ? " selected" : ""}>${escapeHtml(category)}</option>`).join("");
  }

  function populateCategorySelects() {
    const categorySelect = $("#transaction-category");
    categorySelect.innerHTML = categoryOptions(activeType);
    const previousFilter = $("#category-filter").value;
    const allCategories = [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])].sort((a, b) => a.localeCompare(b));
    $("#category-filter").innerHTML = `<option value="all">All categories</option>${allCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    if (allCategories.includes(previousFilter)) $("#category-filter").value = previousFilter;
  }

  function setTheme(theme, save = true) {
    const previousTheme = state.theme;
    state.theme = theme === "dark" ? "dark" : "light";
    const requestedTheme = state.theme;
    document.body.classList.toggle("dark", state.theme === "dark");
    $$(".theme-icon").forEach((el) => { el.setAttribute("data-lucide", state.theme === "dark" ? "sun" : "moon"); });
    if (save && currentUser) {
      saveSettings()
        .catch((error) => {
          if (currentUser && state.theme === requestedTheme) {
            state.theme = previousTheme;
            document.body.classList.toggle("dark", state.theme === "dark");
            $$(".theme-icon").forEach((el) => { el.setAttribute("data-lucide", state.theme === "dark" ? "sun" : "moon"); });
            refreshIcons();
            updateCharts();
          }
          toast(error.message, "error");
        });
    }
    refreshIcons();
    updateCharts();
  }

  function updateCurrencyControls() {
    $("#currency-select").value = state.currency;
    $("#settings-currency").value = state.currency;
    $("#amount-symbol").textContent = CURRENCIES[state.currency].symbol;
    $("#budget-symbol").textContent = CURRENCIES[state.currency].symbol;
  }

  function setPage(name) {
    const pageName = name === "settings" ? "settings" : name;
    $$(".page-section").forEach((section) => section.classList.toggle("active", section.id === `page-${pageName}`));
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.nav === pageName));
    const crumbs = { dashboard: "Overview", transactions: "Transactions", budgets: "Budgets", reports: "Reports", settings: "Settings" };
    $("#page-crumb").textContent = crumbs[pageName] || "Overview";
    $("#sidebar").classList.remove("open");
    $("#mobile-backdrop").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (pageName === "reports") updateReports();
    refreshIcons();
  }

  function renderDashboard() {
    const monthTransactions = getMonthTransactions(dashboardMonth);
    const budgets = budgetsFor(dashboardMonth);
    const income = sum(monthTransactions.filter((item) => item.type === "income"));
    const expenses = sum(monthTransactions.filter((item) => item.type === "expense"));
    const totalBalance = sum(state.transactions.filter((item) => item.type === "income")) - sum(state.transactions.filter((item) => item.type === "expense"));
    const budgetRemaining = budgets.monthly > 0 ? budgets.monthly - expenses : 0;

    $("#current-month-label").textContent = monthLabel(dashboardMonth);
    $("#dashboard-month").value = dashboardMonth;
    $("#total-balance").textContent = formatMoney(totalBalance);
    $("#total-income").textContent = formatMoney(income);
    $("#total-expenses").textContent = formatMoney(expenses);
    $("#monthly-savings").textContent = formatMoney(income - expenses);
    $("#savings-caption").textContent = income > 0 ? `${Math.round(((income - expenses) / income) * 100)}% savings rate` : "Income minus expenses";
    $("#dashboard-budget-remaining").textContent = budgets.monthly > 0 ? formatMoney(budgetRemaining) : "—";
    $("#dashboard-budget-caption").textContent = budgets.monthly > 0
      ? (budgetRemaining < 0 ? "Over your monthly limit" : "Available to spend this month")
      : "Set a monthly budget";
    $("#summary-month-label").textContent = monthLabel(dashboardMonth);
    $("#summary-income").textContent = formatMoney(income);
    $("#summary-expenses").textContent = formatMoney(expenses);
    $("#summary-savings").textContent = formatMoney(income - expenses);

    const monthlyBudget = budgets.monthly;
    const percent = monthlyBudget > 0 ? Math.round((expenses / monthlyBudget) * 100) : 0;
    $("#budget-used").textContent = formatMoney(expenses);
    $("#budget-total").textContent = monthlyBudget > 0 ? formatMoney(monthlyBudget) : formatMoney(0);
    $("#budget-left").textContent = monthlyBudget > 0
      ? (budgetRemaining >= 0 ? `${formatMoney(budgetRemaining)} remaining` : `${formatMoney(Math.abs(budgetRemaining))} over budget`)
      : "Set a monthly budget";
    $("#budget-percent").textContent = `${percent}%`;
    const budgetProgress = $("#budget-progress");
    budgetProgress.style.width = `${Math.min(percent, 100)}%`;
    budgetProgress.className = percent >= 100 ? "over" : percent >= 80 ? "warning" : "";
    $("#dashboard-categories").innerHTML = dashboardCategorySummary(dashboardMonth);

    const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 4);
    $("#recent-transactions").innerHTML = recent.length
      ? recent.map((item) => transactionRow(item, false)).join("")
      : `<div class="empty-inline">No transactions yet. Add one to get started.</div>`;
    $("#transaction-count").textContent = String(state.transactions.length);
    $("#summary-note").innerHTML = income || expenses
      ? `${icon("lightbulb")}<span>${expenses > income ? "Your spending is higher than income this month. Consider reviewing your budget." : `You have ${formatMoney(income - expenses)} left after expenses this month.`}</span>`
      : `${icon("lightbulb")}<span>Start adding transactions to get your monthly insights.</span>`;
    updateCharts();
    refreshIcons();
  }

  function monthlyBudgetValue() {
    return validNonNegative(budgetsFor(dashboardMonth).monthly);
  }

  function dashboardCategorySummary(month) {
    const totals = {};
    getMonthTransactions(month, "expense").forEach((item) => { totals[item.category] = (totals[item.category] || 0) + Number(item.amount); });
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (!entries.length) return `<div class="empty-inline">No spending to show yet.</div>`;
    return entries.map(([category, amount]) => `<div class="mini-category-row"><span class="mini-category-name"><i class="category-color-dot" style="background:${categoryColor(category)}"></i>${escapeHtml(category)}</span><span class="mini-category-amount">${formatMoney(amount)}</span></div>`).join("");
  }

  function transactionRow(item, withActions = true) {
    const symbol = item.type === "income" ? "arrow-down-left" : "arrow-up-right";
    const amountClass = item.type === "income" ? "income-amount" : "";
    if (!withActions) {
      return `<div class="transaction-row"><span class="transaction-symbol">${icon(symbol)}</span><span class="transaction-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${formatDate(item.date, { day: "numeric", month: "short" })}</small></span><span class="transaction-amount ${amountClass}">${item.type === "income" ? "+" : "−"}${formatMoney(item.amount)}</span></div>`;
    }
    return `<tr>
      <td><div class="table-transaction"><span class="transaction-symbol">${icon(symbol)}</span><span><strong>${escapeHtml(item.title)}</strong><small>${item.type === "income" ? "Income" : "Expense"}</small></span></div></td>
      <td><span class="category-chip">${escapeHtml(item.category)}</span></td>
      <td>${formatDate(item.date)}</td><td>${escapeHtml(item.notes || "—")}</td>
      <td class="table-amount ${amountClass}">${item.type === "income" ? "+" : "−"}${formatMoney(item.amount)}</td>
      <td><div class="row-actions"><button class="row-action" data-edit="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.title)}" title="Edit">${icon("pencil")}</button><button class="row-action delete" data-delete="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.title)}" title="Delete">${icon("trash-2")}</button></div></td>
    </tr>`;
  }

  function renderTransactions() {
    const query = $("#transaction-search").value.trim().toLocaleLowerCase();
    const type = $("#type-filter").value;
    const category = $("#category-filter").value;
    const selectedMonth = $("#date-filter").value;
    const sort = $("#sort-filter").value;
    let items = state.transactions.filter((item) => {
      const matchesQuery = !query || [item.title, item.category, item.notes || ""].some((value) => value.toLocaleLowerCase().includes(query));
      return matchesQuery && (type === "all" || item.type === type) && (category === "all" || item.category === category) && (!selectedMonth || item.date.slice(0, 7) === selectedMonth);
    });
    items.sort((a, b) => {
      if (sort === "oldest") return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
      if (sort === "highest") return Number(b.amount) - Number(a.amount) || b.date.localeCompare(a.date);
      if (sort === "lowest") return Number(a.amount) - Number(b.amount) || b.date.localeCompare(a.date);
      return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
    });
    $("#transaction-table-body").innerHTML = items.map((item) => transactionRow(item)).join("");
    const empty = $("#transactions-empty");
    empty.style.display = items.length ? "none" : "flex";
    $("#transaction-result-count").textContent = `Showing ${items.length} of ${state.transactions.length} transaction${state.transactions.length === 1 ? "" : "s"}`;
    refreshIcons();
  }

  function renderBudgets() {
    const budgets = budgetsFor(currentMonth);
    const spent = sum(getMonthTransactions(currentMonth, "expense"));
    const monthlyBudget = budgets.monthly;
    $("#budgets-total").textContent = formatMoney(monthlyBudget);
    $("#budgets-spent").textContent = formatMoney(spent);
    $("#budgets-remaining").textContent = monthlyBudget > 0 ? formatMoney(monthlyBudget - spent) : "—";
    $("#budgets-period").textContent = monthLabel(currentMonth);
    $("#budgets-month-label").textContent = monthLabel(currentMonth);
    $("#budgets-spent-caption").textContent = monthlyBudget > 0 ? `${Math.round(spent / monthlyBudget * 100)}% of total budget` : "Across all categories";
    $("#budgets-remaining-caption").textContent = monthlyBudget > 0 ? (spent > monthlyBudget ? "You are over your monthly limit" : "Available for the rest of the month") : "Set a limit to track progress";

    $("#category-budgets-list").innerHTML = EXPENSE_CATEGORIES.map((category) => {
      const amount = sum(getMonthTransactions(currentMonth, "expense").filter((item) => item.category === category));
      const limit = validNonNegative(budgets.categories[category]);
      const percent = limit > 0 ? Math.round(amount / limit * 100) : 0;
      const progressClass = percent >= 100 ? "over" : percent >= 80 ? "warning" : "";
      return `<div class="category-budget-row">
        <div class="category-budget-head"><span class="category-budget-name"><i class="category-color-dot" style="background:${categoryColor(category)}"></i><span><strong>${escapeHtml(category)}</strong><small>${limit > 0 ? `${formatMoney(amount)} spent` : `${formatMoney(amount)} spent this month`}</small></span></span>
          ${limit > 0 ? `<span class="category-budget-stat"><strong>${formatMoney(amount)}</strong> / ${formatMoney(limit)}</span>` : `<span class="category-unset">No limit</span>`}</div>
        ${limit > 0 ? `<div class="progress-track category-progress"><span class="${progressClass}" style="width:${Math.min(percent, 100)}%"></span></div><div class="category-budget-meta"><span>${amount > limit ? `${formatMoney(amount - limit)} over limit` : `${formatMoney(limit - amount)} remaining`}</span><span>${percent}%</span></div>` : ""}
      </div>`;
    }).join("");
    refreshIcons();
  }

  function chartOptions() {
    const dark = document.body.classList.contains("dark");
    const tickColor = dark ? "#8791a3" : "#929bad";
    const gridColor = dark ? "#2b3240" : "#edf0f5";
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: dark ? "#2a3040" : "#202636", padding: 10, titleFont: { family: "DM Sans", size: 10 }, bodyFont: { family: "DM Sans", size: 10 }, displayColors: true }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: tickColor, font: { family: "DM Sans", size: 9 }, maxRotation: 0 } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: gridColor }, ticks: { color: tickColor, font: { family: "DM Sans", size: 9 }, maxTicksLimit: 5, callback: (value) => compactMoney(value) } }
      }
    };
  }

  function compactMoney(value) {
    const symbol = CURRENCIES[state.currency].symbol;
    if (Math.abs(value) >= 1000000) return `${symbol}${(value / 1000000).toFixed(1)}m`;
    if (Math.abs(value) >= 1000) return `${symbol}${(value / 1000).toFixed(0)}k`;
    return `${symbol}${value}`;
  }

  function drawChart(key, canvasId, type, data, options, hasData, emptyId) {
    const empty = document.getElementById(emptyId);
    const canvas = document.getElementById(canvasId);
    if (!window.Chart) {
      empty.textContent = hasData ? "Charts are unavailable while offline. Your data is saved." : "Add transactions to see your insights.";
      empty.style.display = "flex";
      canvas.style.visibility = "hidden";
      return;
    }
    canvas.style.visibility = hasData ? "visible" : "hidden";
    empty.textContent = "Add transactions to see your insights.";
    empty.style.display = hasData ? "none" : "flex";
    if (charts[key]) charts[key].destroy();
    if (!hasData) return;
    charts[key] = new Chart(canvas, { type, data, options });
  }

  function updateCharts() {
    if (!$("#overview-chart")) return;
    const monthItems = getMonthTransactions(dashboardMonth);
    const base = monthDate(dashboardMonth);
    const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const income = Array(days).fill(0);
    const expenses = Array(days).fill(0);
    monthItems.forEach((item) => {
      const day = Number(item.date.slice(8, 10)) - 1;
      if (item.type === "income") income[day] += Number(item.amount);
      else expenses[day] += Number(item.amount);
    });
    const activeDays = Array.from({ length: days }, (_, index) => index + 1).filter((day, index) => income[index] || expenses[index]);
    const step = Math.max(1, Math.ceil(days / 15));
    const labels = Array.from({ length: days }, (_, index) => index % step === 0 || index === days - 1 ? String(index + 1) : "");
    drawChart("overview", "overview-chart", "line", {
      labels, datasets: [
        { label: "Income", data: income, borderColor: "#20a879", backgroundColor: "rgba(32,168,121,.08)", pointRadius: 0, pointHoverRadius: 4, fill: true, tension: .38, borderWidth: 2 },
        { label: "Expenses", data: expenses, borderColor: "#e77869", backgroundColor: "rgba(231,120,105,.07)", pointRadius: 0, pointHoverRadius: 4, fill: true, tension: .38, borderWidth: 2 }
      ]
    }, { ...chartOptions(), scales: { ...chartOptions().scales, x: { ...chartOptions().scales.x, ticks: { ...chartOptions().scales.x.ticks, callback: (value, index) => labels[index] || "" } } } }, activeDays.length > 0, "overview-chart-empty");
    updateReportsCharts();
  }

  function previousMonths(month, count) {
    const start = monthDate(month);
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth() - (count - 1 - index), 1);
      return monthKey(date);
    });
  }

  function updateReportsCharts() {
    if (!$("#spending-chart")) return;
    const selectedItems = getMonthTransactions(reportMonth);
    const base = monthDate(reportMonth);
    const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const daily = Array(days).fill(0);
    selectedItems.filter((item) => item.type === "expense").forEach((item) => { daily[Number(item.date.slice(8, 10)) - 1] += Number(item.amount); });
    const hasExpenses = daily.some((value) => value > 0);
    const labels = daily.map((_, index) => (index % 4 === 0 || index === days - 1 ? String(index + 1) : ""));
    drawChart("spending", "spending-chart", "bar", {
      labels, datasets: [{ label: "Expenses", data: daily, backgroundColor: "rgba(231,120,105,.78)", hoverBackgroundColor: "#e77869", borderRadius: 4, maxBarThickness: 15 }]
    }, chartOptions(), hasExpenses, "spending-chart-empty");

    const months = previousMonths(reportMonth, 6);
    const monthlyIncome = months.map((month) => sum(getMonthTransactions(month, "income")));
    const monthlyExpenses = months.map((month) => sum(getMonthTransactions(month, "expense")));
    drawChart("comparison", "comparison-chart", "bar", {
      labels: months.map((month) => monthLabel(month, { month: "short" })),
      datasets: [
        { label: "Income", data: monthlyIncome, backgroundColor: "rgba(32,168,121,.78)", borderRadius: 4, maxBarThickness: 22 },
        { label: "Expenses", data: monthlyExpenses, backgroundColor: "rgba(231,120,105,.78)", borderRadius: 4, maxBarThickness: 22 }
      ]
    }, chartOptions(), monthlyIncome.some(Boolean) || monthlyExpenses.some(Boolean), "comparison-chart-empty");

    const categories = {};
    selectedItems.filter((item) => item.type === "expense").forEach((item) => { categories[item.category] = (categories[item.category] || 0) + Number(item.amount); });
    const categoryEntries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    drawChart("category", "category-chart", "doughnut", {
      labels: categoryEntries.map(([category]) => category),
      datasets: [{ data: categoryEntries.map(([, amount]) => amount), backgroundColor: categoryEntries.map(([category]) => categoryColor(category)), borderWidth: 0, hoverOffset: 4 }]
    }, { responsive: true, maintainAspectRatio: false, cutout: "70%", plugins: { legend: { display: false }, tooltip: chartOptions().plugins.tooltip } }, categoryEntries.length > 0, "category-chart-empty");
    $("#category-legend").innerHTML = categoryEntries.slice(0, 6).map(([category, amount]) => `<span class="category-legend-item"><i class="category-color-dot" style="background:${categoryColor(category)}"></i>${escapeHtml(category)} · ${formatMoney(amount)}</span>`).join("");

    const weekly = [0, 0, 0, 0, 0];
    selectedItems.filter((item) => item.type === "expense").forEach((item) => { weekly[Math.min(4, Math.floor((Number(item.date.slice(8, 10)) - 1) / 7))] += Number(item.amount); });
    drawChart("weekly", "weekly-chart", "bar", {
      labels: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"],
      datasets: [{ label: "Expenses", data: weekly, backgroundColor: ["#8b7ee8", "#8b7ee8", "#8b7ee8", "#8b7ee8", "#8b7ee8"], borderRadius: 5, maxBarThickness: 38 }]
    }, chartOptions(), weekly.some(Boolean), "weekly-chart-empty");
  }

  function updateReports() {
    $("#report-month").value = reportMonth;
    const selected = getMonthTransactions(reportMonth);
    const expenses = selected.filter((item) => item.type === "expense");
    const income = sum(selected.filter((item) => item.type === "income"));
    const spent = sum(expenses);
    const categoryTotals = {};
    expenses.forEach((item) => { categoryTotals[item.category] = (categoryTotals[item.category] || 0) + Number(item.amount); });
    const top = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
    $("#top-category").textContent = top ? top[0] : "—";
    $("#top-category-amount").textContent = top ? formatMoney(top[1]) : "No spending yet";
    const currentDate = monthDate(reportMonth);
    const elapsedDays = reportMonth === currentMonth ? now.getDate() : new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    $("#daily-average").textContent = formatMoney(elapsedDays > 0 ? spent / elapsedDays : 0);
    $("#report-savings").textContent = formatMoney(income - spent);
    $("#savings-rate").textContent = income > 0 ? `${Math.round(((income - spent) / income) * 100)}% savings rate` : "Income less expenses";
    updateReportsCharts();
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const firstInput = modal.querySelector("input:not([type=hidden]), select, button");
    if (firstInput) window.setTimeout(() => firstInput.focus(), 30);
  }

  function closeModal(modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!$(".modal-backdrop.open")) document.body.style.overflow = "";
  }

  function openTransactionModal(item = null) {
    $("#transaction-form").reset();
    $("#form-error").textContent = "";
    $("#transaction-id").value = item ? item.id : "";
    $("#transaction-modal-title").textContent = item ? "Edit transaction" : "Add transaction";
    $("#save-transaction").innerHTML = `${icon("check")}${item ? "Save changes" : "Save transaction"}`;
    activeType = item ? item.type : "expense";
    $$(".type-option").forEach((button) => button.classList.toggle("selected", button.dataset.type === activeType));
    $("#transaction-type").value = activeType;
    $("#transaction-title").value = item ? item.title : "";
    $("#transaction-amount").value = item ? item.amount : "";
    $("#transaction-date").value = item ? item.date : new Date().toISOString().slice(0, 10);
    $("#transaction-notes").value = item ? item.notes || "" : "";
    populateCategorySelects();
    if (item) $("#transaction-category").value = item.category;
    updateCurrencyControls();
    openModal("transaction-modal");
    refreshIcons();
  }

  async function saveTransaction(event) {
    event.preventDefault();
    const title = $("#transaction-title").value.trim();
    const amount = Number($("#transaction-amount").value);
    const date = $("#transaction-date").value;
    const category = $("#transaction-category").value;
    const id = $("#transaction-id").value;
    if (!title) return showFormError("Please enter a transaction title.");
    if (!Number.isFinite(amount) || amount <= 0) return showFormError("Enter an amount greater than zero.");
    if (amount > 999999999999) return showFormError("That amount is too large.");
    if (!date || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) return showFormError("Choose a valid transaction date.");
    if (!(activeType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).includes(category)) return showFormError("Choose a valid category.");
    const transaction = {
      id: id || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      title, amount, type: activeType, category, date, notes: $("#transaction-notes").value.trim()
    };
    try {
      const existingIndex = state.transactions.findIndex((item) => item.id === id);
      if (isGuest) {
        if (existingIndex >= 0) state.transactions[existingIndex] = transaction;
        else state.transactions.push(transaction);
      } else {
        const result = existingIndex >= 0
          ? await api(`/api/transactions/${encodeURIComponent(id)}`, { method: "PUT", body: transaction })
          : await api("/api/transactions", { method: "POST", body: transaction });
        if (existingIndex >= 0) state.transactions[existingIndex] = result.transaction;
        else state.transactions.push(result.transaction);
      }
      closeModal($("#transaction-modal"));
      renderAll();
      toast(existingIndex >= 0 ? "Transaction updated." : "Transaction added.");
    } catch (error) {
      showFormError(error.message);
    }
  }

  function showFormError(message) {
    $("#form-error").textContent = message;
    $("#form-error").focus();
  }

  function requestConfirmation(message, acceptText, callback) {
    $("#confirm-message").textContent = message;
    $("#confirm-accept").textContent = acceptText;
    pendingConfirm = callback;
    openModal("confirm-modal");
  }

  function askDelete(id) {
    const item = state.transactions.find((transaction) => transaction.id === id);
    if (!item) return;
    requestConfirmation(`Delete “${item.title}”? This transaction will be permanently removed.`, "Delete", async () => {
      try {
        if (!isGuest) await api(`/api/transactions/${encodeURIComponent(id)}`, { method: "DELETE", body: {} });
        state.transactions = state.transactions.filter((transaction) => transaction.id !== id);
        renderAll();
        toast("Transaction deleted.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  function openBudgetModal() {
    const budgets = budgetsFor(currentMonth);
    $("#budget-form").dataset.month = currentMonth;
    $("#monthly-budget-input").value = budgets.monthly || "";
    $("#category-budget-inputs").innerHTML = EXPENSE_CATEGORIES.map((category) => `<div class="category-budget-field"><label for="category-budget-${slug(category)}">${escapeHtml(category)}</label><input id="category-budget-${slug(category)}" data-budget-category="${escapeHtml(category)}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="No limit" value="${budgets.categories[category] || ""}"></div>`).join("");
    updateCurrencyControls();
    openModal("budget-modal");
  }

  function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  async function saveBudgets(event) {
    event.preventDefault();
    const monthlyText = $("#monthly-budget-input").value.trim();
    const monthly = monthlyText === "" ? 0 : Number(monthlyText);
    if (!Number.isFinite(monthly) || monthly < 0) return toast("Enter a valid monthly budget.", "error");
    const categories = {};
    let invalid = false;
    $$("[data-budget-category]").forEach((input) => {
      const raw = input.value.trim();
      if (!raw) return;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) invalid = true;
      else if (amount > 0) categories[input.dataset.budgetCategory] = amount;
    });
    if (invalid) return toast("Category budgets must be zero or a positive amount.", "error");
    const month = $("#budget-form").dataset.month || currentMonth;
    try {
      const monthBudgets = { monthly: 0, categories: {} };
      if (isGuest) {
        monthBudgets.monthly = monthly;
        monthBudgets.categories = categories;
      } else {
        const result = await api("/api/budgets", { method: "POST", body: { month, monthly, categories } });
        result.budgets.forEach((budget) => {
          if (budget.category) monthBudgets.categories[budget.category] = budget.amount;
          else monthBudgets.monthly = budget.amount;
        });
      }
      state.budgetsByMonth[month] = monthBudgets;
      closeModal($("#budget-modal"));
      renderAll();
      toast("Budgets saved.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function csvEscape(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadFile(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function offerLegacyBackup() {
    try {
      const saved = localStorage.getItem("moneta-expense-tracker-v1");
      if (!saved) return;
      const legacyData = JSON.parse(saved);
      if (!legacyData || !Array.isArray(legacyData.transactions)) return;
      $("#legacy-recovery").hidden = false;
      $("#export-legacy-backup").addEventListener("click", () => {
        downloadFile("moneta-previous-local-data.json", saved, "application/json");
      }, { once: true });
    } catch (error) {
      console.error("Could not inspect previous local Moneta data.");
    }
  }

  function exportCsv() {
    const rows = [["Date", "Type", "Title", "Category", "Amount", "Notes"]];
    [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((item) => rows.push([item.date, item.type, item.title, item.category, item.amount, item.notes || ""]));
    const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
    downloadFile(`moneta-transactions-${currentMonth}.csv`, csv, "text/csv;charset=utf-8");
    toast("CSV export downloaded.");
  }

  function exportJson() {
    const backup = {
      app: "Moneta",
      version: 2,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      budgetsByMonth: state.budgetsByMonth,
      budgets: budgetsFor(currentMonth),
      currency: state.currency,
      theme: state.theme
    };
    downloadFile(`moneta-backup-${currentMonth}.json`, JSON.stringify(backup, null, 2), "application/json");
    toast("JSON backup downloaded.");
  }

  function importJsonFile(file) {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast("Backup file must be smaller than 5 MB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let backup;
      try {
        backup = JSON.parse(String(reader.result));
      } catch (error) {
        console.error("Invalid JSON backup:", error);
        toast("That file is not valid JSON.", "error");
        return;
      }
      if (!backup || !Array.isArray(backup.transactions)) {
        toast("This file is not a valid Moneta backup.", "error");
        return;
      }
      const transactionsValid = backup.transactions.length <= 5000 && backup.transactions.every(isValidTransaction);
      if (!transactionsValid) {
        toast("The backup contains invalid transactions or exceeds the 5,000 transaction import limit.", "error");
        return;
      }
      const budgetsByMonth = backup.budgetsByMonth && typeof backup.budgetsByMonth === "object"
        ? backup.budgetsByMonth
        : backup.budgets && typeof backup.budgets === "object"
          ? { [currentMonth]: backup.budgets }
          : {};
      if (Object.keys(budgetsByMonth).length > 120 || Object.entries(budgetsByMonth).some(([month, budget]) => !isValidMonthKey(month) || !isValidBackupBudget(budget))) {
        toast("The backup contains invalid budget months.", "error");
        return;
      }
      const guestImport = isGuest;
      requestConfirmation(
        guestImport
          ? "Transactions will be added to this temporary guest session, and matching budgets and preferences will be replaced. Nothing will be saved after you leave."
          : "Transactions will be added to your account. Budgets for matching months and your currency/theme settings will be updated. Existing transactions will not be removed.",
        "Import backup",
        async () => {
        try {
          if (guestImport) {
            state.transactions.push(...backup.transactions.map((item) => ({
              ...item,
              id: window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
            })));
            Object.entries(budgetsByMonth).forEach(([month, budget]) => {
              const categories = budget && budget.categories && typeof budget.categories === "object"
                ? Object.fromEntries(Object.entries(budget.categories).filter(([category, amount]) => EXPENSE_CATEGORIES.includes(category) && Number.isFinite(Number(amount)) && Number(amount) > 0))
                : {};
              state.budgetsByMonth[month] = { monthly: validNonNegative(budget && budget.monthly), categories };
            });
            state.currency = CURRENCIES[backup.currency] ? backup.currency : state.currency;
            state.theme = backup.theme === "dark" ? "dark" : "light";
            setTheme(state.theme, false);
            updateCurrencyControls();
            renderAll();
            toast("Backup loaded for this temporary session only.");
            return;
          }
          for (const item of backup.transactions) {
            const { title, amount, type, category, date, notes = "" } = item;
            await api("/api/transactions", { method: "POST", body: { title, amount, type, category, date, notes } });
          }
          for (const [month, budget] of Object.entries(budgetsByMonth)) {
            const monthly = validNonNegative(budget && budget.monthly);
            const categories = budget && budget.categories && typeof budget.categories === "object"
              ? Object.fromEntries(Object.entries(budget.categories).filter(([category, amount]) => EXPENSE_CATEGORIES.includes(category) && Number.isFinite(Number(amount)) && Number(amount) > 0))
              : {};
            await api("/api/budgets", { method: "POST", body: { month, monthly, categories } });
          }
          const currency = CURRENCIES[backup.currency] ? backup.currency : state.currency;
          const theme = backup.theme === "dark" ? "dark" : "light";
          await api("/api/settings", { method: "PUT", body: { currency, theme } });
          const [transactionData, budgetData] = await Promise.all([api("/api/transactions"), api("/api/budgets")]);
          state.transactions = transactionData.transactions;
          state.budgetsByMonth = {};
          budgetData.budgets.forEach((item) => {
            const monthBudgets = state.budgetsByMonth[item.month] || { monthly: 0, categories: {} };
            if (item.category) monthBudgets.categories[item.category] = item.amount;
            else monthBudgets.monthly = item.amount;
            state.budgetsByMonth[item.month] = monthBudgets;
          });
          state.currency = currency;
          state.theme = theme;
          setTheme(theme, false);
          updateCurrencyControls();
          renderAll();
          toast("Backup imported. Transactions were added without removing existing records.");
        } catch (error) {
          if (guestImport) {
            toast(`Backup import stopped: ${error.message}`, "error");
            return;
          }
          try {
            const [transactionData, budgetData] = await Promise.all([api("/api/transactions"), api("/api/budgets")]);
            state.transactions = transactionData.transactions;
            state.budgetsByMonth = {};
            budgetData.budgets.forEach((item) => {
              const monthBudgets = state.budgetsByMonth[item.month] || { monthly: 0, categories: {} };
              if (item.category) monthBudgets.categories[item.category] = item.amount;
              else monthBudgets.monthly = item.amount;
              state.budgetsByMonth[item.month] = monthBudgets;
            });
            renderAll();
          } catch (refreshError) {
            console.error("Could not refresh data after a partial import.");
          }
          toast(`Backup import stopped: ${error.message}`, "error");
        }
      });
    };
    reader.onerror = () => {
      console.error("Could not read selected backup file:", reader.error);
      toast("Could not read that file.", "error");
    };
    reader.readAsText(file);
  }

  function clearFilters() {
    $("#transaction-search").value = "";
    $("#type-filter").value = "all";
    $("#category-filter").value = "all";
    $("#date-filter").value = "";
    $("#sort-filter").value = "newest";
    renderTransactions();
  }

  function renderAll() {
    renderDashboard();
    renderTransactions();
    renderBudgets();
    updateReports();
    updateCurrencyControls();
  }

  function attachEvents() {
    $$("[data-auth-view]").forEach((button) => button.addEventListener("click", () => setAuthView(button.dataset.authView)));
    $("#guest-mode-button").addEventListener("click", showGuestApp);
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("#login-error").textContent = "";
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          auth: false,
          body: { email: $("#login-email").value, password: $("#login-password").value, rememberMe: $("#remember-me").checked }
        });
        $("#login-form").reset();
        await showAuthenticatedApp(result.user);
      } catch (error) {
        $("#login-error").textContent = error.message;
      }
    });
    $("#register-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("#register-error").textContent = "";
      if ($("#register-password").value !== $("#register-confirm").value) {
        $("#register-error").textContent = "Passwords do not match.";
        return;
      }
      try {
        const result = await api("/api/auth/register", {
          method: "POST",
          auth: false,
          body: {
            fullName: $("#register-name").value,
            email: $("#register-email").value,
            password: $("#register-password").value,
            confirmPassword: $("#register-confirm").value
          }
        });
        $("#register-form").reset();
        await showAuthenticatedApp(result.user);
      } catch (error) {
        $("#register-error").textContent = error.message;
      }
    });
    $("#logout-button").addEventListener("click", async () => {
      if (isGuest) {
        exitGuestMode();
        toast("Guest session ended. Changes were not saved.");
        return;
      }
      try {
        await api("/api/auth/logout", { method: "POST", body: {} });
        currentUser = null;
        isGuest = false;
        document.body.classList.remove("guest-mode");
        state = { transactions: [], budgetsByMonth: {}, currency: "INR", theme: "light" };
        $("#app-shell").hidden = true;
        $("#auth-screen").hidden = false;
        $("#guest-notice").hidden = true;
        setTheme("light", false);
        setAuthView("login");
        toast("You have signed out.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
    $$(".nav-link, [data-nav]").forEach((element) => element.addEventListener("click", () => setPage(element.dataset.nav)));
    $("#quick-add").addEventListener("click", () => openTransactionModal());
    $("#add-transaction").addEventListener("click", () => openTransactionModal());
    $$("[data-add-first]").forEach((button) => button.addEventListener("click", () => openTransactionModal()));
    $("#transaction-form").addEventListener("submit", saveTransaction);
    $$(".type-option").forEach((button) => button.addEventListener("click", () => {
      activeType = button.dataset.type;
      $("#transaction-type").value = activeType;
      $$(".type-option").forEach((option) => option.classList.toggle("selected", option === button));
      const selectedCategory = $("#transaction-category").value;
      $("#transaction-category").innerHTML = categoryOptions(activeType);
      const previousCategories = activeType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      if (previousCategories.includes(selectedCategory)) $("#transaction-category").value = selectedCategory;
    }));
    $$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.closest(".modal-backdrop"))));
    $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop);
    }));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const opened = $(".modal-backdrop.open");
        if (opened) closeModal(opened);
        $("#sidebar").classList.remove("open");
        $("#mobile-backdrop").classList.remove("open");
      }
    });
    $("#transaction-search").addEventListener("input", renderTransactions);
    ["type-filter", "category-filter", "date-filter", "sort-filter"].forEach((id) => $(`#${id}`).addEventListener("change", renderTransactions));
    $("#transaction-table-body").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit]");
      const remove = event.target.closest("[data-delete]");
      if (edit) openTransactionModal(state.transactions.find((item) => item.id === edit.dataset.edit));
      if (remove) askDelete(remove.dataset.delete);
    });
    $("#clear-filters").addEventListener("click", clearFilters);
    $("#export-csv").addEventListener("click", exportCsv);
    $("#edit-budget").addEventListener("click", openBudgetModal);
    $("#budget-tip-action").addEventListener("click", openBudgetModal);
    $("#budget-form").addEventListener("submit", saveBudgets);
    $("#dashboard-month").addEventListener("change", (event) => {
      if (/^\d{4}-\d{2}$/.test(event.target.value)) {
        dashboardMonth = event.target.value;
        renderDashboard();
      }
    });
    $("#report-month").addEventListener("change", (event) => {
      if (/^\d{4}-\d{2}$/.test(event.target.value)) {
        reportMonth = event.target.value;
        updateReports();
      }
    });
    $("#currency-select").addEventListener("change", (event) => changeCurrency(event.target.value));
    $("#settings-currency").addEventListener("change", (event) => changeCurrency(event.target.value));
    $("#theme-toggle").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
    $("#settings-theme").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
    $("#export-json").addEventListener("click", exportJson);
    $("#import-json").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (event) => {
      importJsonFile(event.target.files[0]);
      event.target.value = "";
    });
    $("#clear-data").addEventListener("click", () => requestConfirmation(
      isGuest
        ? "Clear all transactions and budgets from this temporary guest session? This cannot be undone."
        : "This permanently removes all transactions and budgets in your account. Your account and preferences will remain.",
      "Clear financial data",
      async () => {
      try {
        if (!isGuest) await api("/api/account/data", { method: "DELETE", body: {} });
        state.transactions = [];
        state.budgetsByMonth = {};
        dashboardMonth = currentMonth;
        reportMonth = currentMonth;
        renderAll();
        clearFilters();
        toast("Your financial data has been cleared.");
      } catch (error) {
        toast(error.message, "error");
      }
      }
    ));
    $("#confirm-cancel").addEventListener("click", () => {
      closeModal($("#confirm-modal"));
      pendingConfirm = null;
    });
    $("#confirm-accept").addEventListener("click", () => {
      const callback = pendingConfirm;
      pendingConfirm = null;
      closeModal($("#confirm-modal"));
      if (callback) callback();
    });
    $("#mobile-menu").addEventListener("click", () => {
      $("#sidebar").classList.add("open");
      $("#mobile-backdrop").classList.add("open");
    });
    $("#mobile-backdrop").addEventListener("click", () => {
      $("#sidebar").classList.remove("open");
      $("#mobile-backdrop").classList.remove("open");
    });
    $("#profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("#profile-error").textContent = "";
      if (isGuest) {
        $("#profile-error").textContent = "Sign in to update account details.";
        return;
      }
      try {
        const result = await api("/api/account/profile", {
          method: "PUT",
          body: { fullName: $("#profile-name").value, email: $("#profile-email").value }
        });
        currentUser = result.user;
        $("#sidebar-user-name").textContent = currentUser.fullName;
        $("#sidebar-user-email").textContent = currentUser.email;
        toast("Profile updated.");
      } catch (error) {
        $("#profile-error").textContent = error.message;
      }
    });
    $("#password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("#password-error").textContent = "";
      if (isGuest) {
        $("#password-error").textContent = "Sign in to change your password.";
        return;
      }
      try {
        await api("/api/auth/change-password", {
          method: "POST",
          body: {
            currentPassword: $("#current-password").value,
            newPassword: $("#new-password").value,
            confirmPassword: $("#confirm-new-password").value
          }
        });
        $("#password-form").reset();
        toast("Password updated. Other sessions have been signed out.");
      } catch (error) {
        $("#password-error").textContent = error.message;
      }
    });
    $("#delete-account").addEventListener("click", () => {
      if (isGuest) return;
      $("#delete-account-form").reset();
      $("#delete-account-error").textContent = "";
      openModal("account-delete-modal");
    });
    $("#delete-account-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("#delete-account-error").textContent = "";
      if (isGuest) {
        $("#delete-account-error").textContent = "Sign in to delete an account.";
        return;
      }
      try {
        await api("/api/account", { method: "DELETE", body: { password: $("#delete-account-password").value } });
        currentUser = null;
        state = { transactions: [], budgetsByMonth: {}, currency: "INR", theme: "light" };
        closeModal($("#account-delete-modal"));
        $("#app-shell").hidden = true;
        $("#auth-screen").hidden = false;
        setTheme("light", false);
        setAuthView("register");
        toast("Your account and its data have been deleted.");
      } catch (error) {
        $("#delete-account-error").textContent = error.message;
      }
    });
  }

  async function changeCurrency(currency) {
    if (!CURRENCIES[currency]) return;
    const previous = state.currency;
    state.currency = currency;
    updateCurrencyControls();
    try {
      await saveSettings();
      updateCurrencyControls();
      renderAll();
    } catch (error) {
      if (currentUser && state.currency === currency) state.currency = previous;
      updateCurrencyControls();
      toast(error.message, "error");
    }
  }

  async function initialize() {
    populateCategorySelects();
    attachEvents();
    offerLegacyBackup();
    $("#today-label").textContent = `YOUR MONEY, AT A GLANCE · ${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now).toUpperCase()}`;
    $("#dashboard-month").value = dashboardMonth;
    $("#report-month").value = reportMonth;
    refreshIcons();
    try {
      const { user } = await api("/api/auth/me", { auth: false });
      await showAuthenticatedApp(user);
    } catch (error) {
      if (error.status !== 401) {
        $("#login-error").textContent = error.message;
        toast(error.message, "error");
      }
      $("#auth-screen").hidden = false;
      $("#app-shell").hidden = true;
      setTheme("light", false);
    }
  }

  initialize();
})();
