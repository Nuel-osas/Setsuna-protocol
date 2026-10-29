// stats.setsuna.finance page: fetches /api/stats and draws it. Refreshes every two minutes.
(() => {
  const GROUPS = ["organic", "incentivized", "team"];
  const NAMES = { organic: "Organic", incentivized: "Rewarded", team: "Team" };
  const COLORS = { organic: "#2338ff", incentivized: "#8f9bff", team: "#c9c5bc" };
  const LABELS = {
    totalVolumeUSD: "Total volume, spot + Earn, USD",
    earnVolumeUSD: "Earn volume, deposits + withdrawals, USD",
    earnDeposits: "Earn deposits",
    earnWithdrawals: "Earn withdrawals",
    spotExecutions: "Spot executions",
    largestWalletSharePct: "Volume from largest wallet",
    perpsTraders: "Perps traders",
    perpsOrders: "Perps orders sent",
    limitOrderTraders: "Limit-order traders",
    earnDepositors: "Earn depositors, any size",
    tvlMON: "setsMON held, MON",
    ausdSavers: "AUSD savers (setsAUSD)",
    tvlAUSD: "setsAUSD held, AUSD",
  };
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const fmt = (v, unit) => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (unit === "%") return `${d3.format(".0f")(n)}%`;
    if (unit === "USDC") return n >= 10000 ? compact.format(n) : d3.format(",.2~f")(n);
    return d3.format(",")(n);
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const $ = (id) => document.getElementById(id);
  let last = null;
  let readAt = 0;

  function cards(rows) {
    $("cards").replaceChildren(
      ...rows.map((r) => {
        const card = el("article", "st-card");
        const ext = r.external === null || r.external === undefined ? null : Number(r.external);
        const pct = ext === null ? 0 : Math.max(0, Math.min(1, ext / Number(r.target_low)));
        const top = el("div", "st-card-top");
        top.append(
          el("span", "st-label", r.label),
          el("span", "st-chip " + (ext === null || ext === 0 ? "is-zero" : pct >= 1 ? "is-met" : "is-moving"), ext === null ? "no data yet" : ext === 0 ? "not started" : pct >= 1 ? "target met" : "under way"),
        );
        const big = el("div", "st-big");
        const target = el("span", "st-target");
        target.append("of ", el("span", null, fmt(r.target_low, r.unit)));
        if (r.target_high !== null) target.append("–", el("span", null, fmt(r.target_high, r.unit)));
        else target.append("+");
        big.append(el("span", "st-num", fmt(ext, r.unit)), target);
        const prog = el("div", "st-progress");
        prog.setAttribute("role", "img");
        prog.setAttribute("aria-label", `${Math.round(pct * 100)}% of the target`);
        const lit = Math.round(pct * 20);
        for (let i = 0; i < 20; i++) prog.append(el("i", i < lit ? (pct >= 1 ? "on full" : "on") : ""));
        const split = el("div", "st-split");
        for (const g of GROUPS) {
          const s = el("span");
          s.append(el("em", null, `${NAMES[g]} `), fmt(r[g], r.unit));
          split.append(s);
        }
        card.append(top, big, prog, el("p", "st-def", r.definition), split);
        return card;
      }),
    );
  }

  function legend(id) {
    $(id).replaceChildren(
      ...GROUPS.map((g) => {
        const s = el("span");
        const i = el("i");
        i.style.background = COLORS[g];
        s.append(i, NAMES[g]);
        return s;
      }),
    );
  }

  function stacked(id, rows, field, unit) {
    const box = $(id);
    box.replaceChildren();
    const days = [...new Set(rows.map((r) => r.day))];
    const table = days.map((day) => {
      const o = { day: new Date(day + "T00:00:00Z") };
      for (const g of GROUPS) o[g] = Number(rows.find((r) => r.day === day && r.group === g)?.[field] ?? 0);
      return o;
    });
    const total = d3.max(table, (d) => GROUPS.reduce((s, g) => s + d[g], 0)) || 0;
    const W = Math.max(280, box.clientWidth);
    const H = 220;
    const y = d3.scaleLinear([0, total > 0 ? total : 1], [H - 24, 10]).nice();
    const svg = d3.select(box).append("svg").attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", box.closest(".st-panel").querySelector("h3").textContent);
    const ticks = y.ticks(4).filter((t) => unit === "USDC" || Number.isInteger(t));
    const probe = svg.append("text").text(ticks.map((t) => fmt(t, unit)).sort((a, b) => b.length - a.length)[0] || "0");
    const left = Math.ceil(probe.node().getComputedTextLength()) + 12;
    probe.remove();
    const x = d3.scaleBand(table.map((d) => d.day), [left, W - 4]).padding(0.28);
    svg.append("g").selectAll("line").data(ticks).join("line").attr("x1", left).attr("x2", W - 4).attr("y1", (t) => y(t)).attr("y2", (t) => y(t)).attr("stroke", "#e6e2d8");
    svg.append("g").selectAll("text").data(ticks).join("text").attr("x", left - 8).attr("y", (t) => y(t) + 4).attr("text-anchor", "end").text((t) => fmt(t, unit));
    const every = Math.max(1, Math.ceil(table.length / Math.max(1, Math.floor((W - left) / 60))));
    svg.append("g").selectAll("text").data(table.filter((_, i) => i % every === 0)).join("text").attr("x", (d) => x(d.day) + x.bandwidth() / 2).attr("y", H - 6).attr("text-anchor", "middle").text((d) => d3.utcFormat("%b %-d")(d.day));
    svg.append("g").selectAll("g").data(d3.stack().keys(GROUPS)(table)).join("g").attr("fill", (s) => COLORS[s.key])
      .selectAll("rect").data((s) => s).join("rect")
      .attr("x", (d) => x(d.data.day)).attr("width", x.bandwidth()).attr("rx", 3)
      .attr("y", (d) => y(d[1])).attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])));
    const tip = el("div", "st-tip");
    tip.hidden = true;
    box.append(tip);
    svg.append("g").selectAll("rect").data(table).join("rect").attr("x", (d) => x(d.day)).attr("width", x.bandwidth()).attr("y", 0).attr("height", H - 24).attr("fill", "transparent")
      .on("mousemove", (event, d) => {
        tip.replaceChildren(el("div", null, d3.utcFormat("%a %b %-d")(d.day)), ...GROUPS.map((g) => el("div", null, `${NAMES[g]}  ${fmt(d[g], unit)}`)));
        tip.hidden = false;
        const [px, py] = d3.pointer(event, box);
        tip.style.left = `${Math.max(0, Math.min(px + 12, box.clientWidth - tip.offsetWidth - 4))}px`;
        tip.style.top = `${Math.max(0, py - 44)}px`;
      })
      .on("mouseleave", () => (tip.hidden = true));
    if (!total) box.append(el("p", "st-empty", "Nothing yet in this window."));
  }

  function fill(id, rows, cells) {
    document.querySelector(`#${id} tbody`).replaceChildren(
      ...rows.map((r) => {
        const tr = el("tr");
        for (const c of cells) {
          const td = el("td", c.cls || "");
          const v = c(r);
          if (v instanceof Node) td.append(v);
          else td.textContent = v;
          tr.append(td);
        }
        return tr;
      }),
    );
  }

  function draw(report) {
    const s = report.snapshot;
    const wallets = report.scorecard.find((r) => r.metric === "activatedWallets");
    const tk = $("takeaway");
    tk.replaceChildren();
    const b = el("b", null, fmt(wallets.external));
    const teamOnly = !wallets.external && wallets.team;
    tk.append(b, ` external wallets so far against a target of ${fmt(wallets.target_low)}–${fmt(wallets.target_high)}.`, teamOnly ? " All activity so far is the team's own, shown apart." : " Team wallets are counted apart and never as users.");
    $("meta").replaceChildren(
      el("span", null, `Through block ${d3.format(",")(s.through_block)}`),
      el("span", null, `Chain time ${d3.utcFormat("%b %-d, %H:%M UTC")(new Date(s.at))}`),
      el("span", null, `${s.team_wallets} team wallets excluded`),
      el("span", null, `${s.incentivized_wallets} rewarded wallets listed`),
    );
    users(report.accounts);
    cards(report.scorecard);
    legend("legend-wallets");
    legend("legend-volume");
    stacked("chart-wallets", report.daily, "new_wallets", "count");
    stacked("chart-volume", report.daily, "volume_usd", "USDC");
    fill("activity-table", report.activity, [
      (r) => LABELS[r.metric] || r.metric,
      ...GROUPS.map((g) => (r) => fmt(r[g], r.metric === "largestWalletSharePct" ? "%" : ["tvlMON", "tvlAUSD", "totalVolumeUSD", "earnVolumeUSD"].includes(r.metric) ? "USDC" : "count")),
    ]);
    const addr = (r) => `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`;
    addr.cls = "addr";
    fill("wallet-table", report.wallets, [
      addr,
      (r) => el("span", `st-grp ${r.group}`, NAMES[r.group] || r.group),
      (r) => (r.first_seen ? d3.utcFormat("%b %-d")(new Date(r.first_seen)) : "—"),
      (r) => fmt(r.spot_volume_usdc, "USDC"),
      (r) => fmt(r.spot_trades),
      (r) => fmt(r.spot_days),
      (r) => fmt(r.earn_volume_usd, "USDC"),
      (r) => fmt(r.earn_usdc, "USDC"),
      (r) => fmt(r.earn_mon, "USDC"),
      (r) => fmt(r.earn_ausd, "USDC"),
      (r) => fmt(r.perps_orders),
      (r) => fmt(r.limit_orders),
    ]);
  }

  function users(a) {
    const note = $("users-note");
    const card = (label, value, def) => {
      const c = el("article", "st-card");
      const top = el("div", "st-card-top");
      top.append(el("span", "st-label", label));
      const big = el("div", "st-big");
      big.append(el("span", "st-num", value));
      c.append(top, big, el("p", "st-def", def));
      return c;
    };
    if (!a || !a.available) {
      const onchain = report => report.wallets.filter((w) => w.group !== "team").length;
      $("user-cards").replaceChildren(card("Active wallets", fmt(onchain(last)), "Any deposit or trade on chain, team excluded. Includes every login type."));
      note.textContent = a?.reason === "privy_error"
        ? `Couldn't read Privy just now${a.status ? ` (${a.status})` : ""}, so email and Google sign-ups are missing. Check PRIVY_APP_SECRET in the setsuna-stats project.`
        : "Email and Google sign-ups appear here once PRIVY_APP_ID and PRIVY_APP_SECRET are set in the setsuna-stats Vercel project.";
      fill("users-table", [], []);
      return;
    }
    const m = a.privy_by_method;
    const split = Object.entries(m).map(([k, v]) => `${v} ${k}`).join(" · ") || "none yet";
    $("user-cards").replaceChildren(
      card("Users", fmt(a.users_total), "Email and Google accounts, plus passkey or wallet users seen on chain."),
      card("Email / Google sign-ups", fmt(a.privy_accounts), `From Privy: ${split}.`),
      card("Passkey or wallet users", fmt(a.passkey_or_wallet_users), "Deposited or traded from a wallet that isn't a Privy account. Passkeys leave no sign-up record, so this is how they show."),
      card("Sign-up to first deposit", a.privy_activation_pct === null ? "—" : `${fmt(a.privy_activation_pct)}%`, `${fmt(a.privy_activated)} of ${fmt(a.privy_accounts)} email/Google accounts have deposited or traded.`),
    );
    note.textContent = a.team_privy_accounts ? `${a.team_privy_accounts} team Privy account${a.team_privy_accounts > 1 ? "s" : ""} not counted.` : "";
    fill("users-table", [...a.daily].reverse(), [
      (r) => d3.utcFormat("%a %b %-d")(new Date(r.day + "T00:00:00Z")),
      (r) => fmt(r.privy_signups),
      (r) => fmt(r.passkey_or_wallet_users),
    ]);
  }

  function status() {
    if (!readAt) return;
    const s = Math.round((Date.now() - readAt) / 1000);
    $("status").textContent = s < 60 ? `Updated ${s}s ago` : `Updated ${Math.round(s / 60)} min ago`;
  }

  async function load() {
    const btn = $("refresh");
    btn.disabled = true;
    $("status").textContent = "Reading the chain…";
    try {
      const res = await fetch("/api/stats", { cache: "no-store", credentials: "same-origin" });
      if (res.status === 401) return location.assign("/login");
      if (!res.ok) throw new Error(String(res.status));
      last = await res.json();
      readAt = Date.now();
      $("error").hidden = true;
      draw(last);
      status();
    } catch {
      $("error").hidden = false;
      $("error").textContent = last
        ? "Couldn't reach Monad just now. Showing the last numbers read; try Refresh in a minute."
        : "Couldn't read Monad just now. Try Refresh in a minute.";
      $("status").textContent = "Read failed";
    } finally {
      btn.disabled = false;
    }
  }

  $("refresh").addEventListener("click", load);
  addEventListener("resize", () => last && draw(last));
  setInterval(status, 15_000);
  setInterval(() => document.visibilityState === "visible" && load(), 120_000);
  load();
})();
