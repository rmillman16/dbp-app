// DBP Timeline's MS Project XML and Primavera P6 XER exports (reference/timeline-app-2026-11-21.html:
// buildMSProjectXML, buildXER, exportFileName, downloadFile), ported to take the programme in
// Timeline's layout (timelineFormat.ts) instead of Timeline's global state.
import type { TLState, TLTask } from './timelineFormat'
import { advanceWorkingDays, computeLateFinishes, getRenderList, taskEndDate, toISO, tradeResolver, workingDaysBetween, type TLDated } from './timelineDates'

// ── MS PROJECT XML EXPORT ─────────────────────────────────────────────────
// Microsoft Project's XML interchange format: Project opens it via File > Open (then Save As .mpp) and
// P6 imports it too. Sections become summary tasks; each task gets a Start No Earlier Than constraint
// so imported dates match the screen rather than being re-levelled.
const MSP_TEXT1 = 188743731,
  MSP_TEXT2 = 188743734 // Text1 = Trade, Text2 = RAG
export const xmlEsc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string)
export const mspDuration = (days: number) => 'PT' + days * 8 + 'H0M0S'

/** `now` only stands in for "today" when the programme has no tasks */
export function buildMSProjectXML(state: TLState, now: Date = new Date()): string {
  const dayStart = (iso: string) => iso + 'T08:00:00'
  const dayEnd = (iso: string) => iso + 'T17:00:00'
  // Milestones sit at the end of their day so an FS successor starts the next working day, as in the app.
  const taskStartDT = (t: TLDated) => (t.milestone ? dayEnd(t.start) : dayStart(t.start))
  const taskFinishDT = (t: TLDated) => (t.milestone ? dayEnd(t.start) : dayEnd(toISO(taskEndDate(state, t))))
  type Row = { kind: 'group'; group: TLState['groups'][number]; uid: number } | { kind: 'task'; task: TLTask; uid: number; level: 1 | 2 }
  const rows: Row[] = [] // in display order
  const uidOf = new Map<string, number>() // task id -> MSP UID
  let uid = 1
  getRenderList(state, { forPrint: true, unfiltered: true }).forEach((item) => {
    if (item.type === 'group') {
      if (!item.empty) rows.push({ kind: 'group', group: item.group, uid: uid++ })
    } else {
      const grouped = !!item.task.groupId && state.groups.some((g) => g.id === item.task.groupId)
      uidOf.set(item.task.id, uid)
      rows.push({ kind: 'task', task: item.task, uid: uid++, level: grouped ? 2 : 1 })
    }
  })
  const starts = state.tasks.map((t) => t.start).sort()
  const projStart = starts.length ? starts[0] : toISO(now)
  const linkType: Record<string, number> = { FF: 0, FS: 1, SS: 3 }
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  out.push('<Project xmlns="http://schemas.microsoft.com/project">')
  out.push('<SaveVersion>14</SaveVersion>')
  out.push('<Name>' + xmlEsc(state.projectName) + '</Name>')
  out.push('<Title>' + xmlEsc(state.projectName) + '</Title>')
  out.push('<ScheduleFromStart>1</ScheduleFromStart>')
  out.push('<StartDate>' + dayStart(projStart) + '</StartDate>')
  out.push('<CalendarUID>1</CalendarUID>')
  out.push('<DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime>')
  out.push('<MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>')
  out.push(
    '<ExtendedAttributes>' +
      '<ExtendedAttribute><FieldID>' +
      MSP_TEXT1 +
      '</FieldID><FieldName>Text1</FieldName><Alias>Trade</Alias></ExtendedAttribute>' +
      '<ExtendedAttribute><FieldID>' +
      MSP_TEXT2 +
      '</FieldID><FieldName>Text2</FieldName><Alias>RAG</Alias></ExtendedAttribute>' +
      '</ExtendedAttributes>',
  )
  // Mon–Fri, 08:00–12:00 + 13:00–17:00, matching the app's weekends-only calendar; shutdowns as exceptions.
  let cal = '<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>'
  for (let d = 1; d <= 7; d++) {
    const working = d !== 1 && d !== 7 // 1 = Sunday, 7 = Saturday
    cal +=
      '<WeekDay><DayType>' +
      d +
      '</DayType><DayWorking>' +
      (working ? 1 : 0) +
      '</DayWorking>' +
      (working
        ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
        : '') +
      '</WeekDay>'
  }
  cal += '</WeekDays>'
  const shut = (state.shutdowns || []).filter((p) => p.start && p.end)
  if (shut.length) {
    cal += '<Exceptions>'
    shut.forEach((p) => {
      cal +=
        '<Exception><EnteredByOccurrences>0</EnteredByOccurrences><Name>' +
        xmlEsc(p.name || 'Shutdown') +
        '</Name>' +
        '<Type>1</Type><DayWorking>0</DayWorking>' +
        '<TimePeriod><FromDate>' +
        p.start +
        'T00:00:00</FromDate><ToDate>' +
        p.end +
        'T23:59:00</ToDate></TimePeriod></Exception>'
    })
    cal += '</Exceptions>'
  }
  out.push(cal + '</Calendar></Calendars>')
  out.push('<Tasks>')
  let top = 0,
    sub = 0
  rows.forEach((r, i) => {
    const id = i + 1
    if (r.kind === 'group') {
      top++
      sub = 0
      const kids = state.tasks.filter((t) => t.groupId === r.group.id)
      const s = kids.map(taskStartDT).sort()[0]
      const f = kids.map(taskFinishDT).sort().pop()
      out.push(
        '<Task><UID>' +
          r.uid +
          '</UID><ID>' +
          id +
          '</ID><Name>' +
          xmlEsc(r.group.name) +
          '</Name>' +
          '<Active>1</Active><Manual>0</Manual>' +
          '<OutlineNumber>' +
          top +
          '</OutlineNumber><OutlineLevel>1</OutlineLevel>' +
          '<Start>' +
          s +
          '</Start><Finish>' +
          f +
          '</Finish>' +
          '<Milestone>0</Milestone><Summary>1</Summary></Task>',
      )
      return
    }
    const t = r.task
    let outline: string
    if (r.level === 2) {
      sub++
      outline = top + '.' + sub
    } else {
      top++
      sub = 0
      outline = '' + top
    }
    let x =
      '<Task><UID>' +
      r.uid +
      '</UID><ID>' +
      id +
      '</ID><Name>' +
      xmlEsc(t.name) +
      '</Name>' +
      '<Active>1</Active><Manual>0</Manual>' +
      '<OutlineNumber>' +
      outline +
      '</OutlineNumber><OutlineLevel>' +
      r.level +
      '</OutlineLevel>' +
      '<Start>' +
      taskStartDT(t) +
      '</Start><Finish>' +
      taskFinishDT(t) +
      '</Finish>' +
      '<Duration>' +
      mspDuration(t.milestone ? 0 : t.duration) +
      '</Duration><DurationFormat>7</DurationFormat>' +
      '<Milestone>' +
      (t.milestone ? 1 : 0) +
      '</Milestone><Summary>0</Summary>' +
      '<ConstraintType>4</ConstraintType><ConstraintDate>' +
      taskStartDT(t) +
      '</ConstraintDate>'
    if (t.prereqNote) x += '<Notes>' + xmlEsc(t.prereqNote) + '</Notes>'
    ;(t.predecessors || []).forEach((p) => {
      const pu = uidOf.get(p.id)
      if (!pu) return
      // LinkLag is in tenths of a minute: 1 day = 480 min = 4800.
      x +=
        '<PredecessorLink><PredecessorUID>' +
        pu +
        '</PredecessorUID><Type>' +
        (p.type in linkType ? linkType[p.type] : 1) +
        '</Type>' +
        '<CrossProject>0</CrossProject><LinkLag>' +
        (p.lag || 0) * 4800 +
        '</LinkLag><LagFormat>7</LagFormat></PredecessorLink>'
    })
    if (t.trade) x += '<ExtendedAttribute><FieldID>' + MSP_TEXT1 + '</FieldID><Value>' + xmlEsc(t.trade) + '</Value></ExtendedAttribute>'
    if (t.rag) x += '<ExtendedAttribute><FieldID>' + MSP_TEXT2 + '</FieldID><Value>' + xmlEsc(t.rag.toUpperCase()) + '</Value></ExtendedAttribute>'
    if (t.baselineStart) {
      const b = { ...t, start: t.baselineStart, duration: t.baselineDuration || t.duration }
      x +=
        '<Baseline><Number>0</Number><Start>' +
        taskStartDT(b) +
        '</Start><Finish>' +
        taskFinishDT(b) +
        '</Finish>' +
        '<Duration>' +
        mspDuration(t.milestone ? 0 : b.duration) +
        '</Duration><DurationFormat>7</DurationFormat></Baseline>'
    }
    out.push(x + '</Task>')
  })
  out.push('</Tasks>')
  out.push('</Project>')
  return out.join('\n')
}

// ── PRIMAVERA P6 XER EXPORT ───────────────────────────────────────────────
// XER is tab-delimited text: an ERMHDR line, then per table %T (name), %F (field names), %R (rows),
// ending with %E. Sections become WBS nodes under the project root node, trades become a project
// activity code, and each activity gets a Start On or After constraint (P6's SNET) so dates match the
// screen after scheduling. Written as Windows-1252 bytes, as P6 does, with typographic punctuation
// folded to ASCII: importers disagree on whether XER is Windows-1252 or UTF-8, and plain ASCII reads
// the same in both.
const XER_ASCII_FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '*',
  ' ': ' ',
  '€': 'EUR',
}
export function encodeCP1252(str: string): Uint8Array<ArrayBuffer> {
  const out: number[] = []
  for (const ch of str) {
    const f = XER_ASCII_FOLD[ch]
    if (f) {
      for (const c of f) out.push(c.charCodeAt(0))
      continue
    }
    const c = ch.codePointAt(0) as number
    out.push(c <= 0xff ? c : 0x3f)
  }
  return new Uint8Array(out)
}
export function hexColor(c: string | null | undefined) {
  const h = (c || '').replace('#', '')
  return (h.length === 3 ? h.replace(/./g, '$&$&') : h).toUpperCase()
}

type XerRow = Record<string, string | number | undefined>

/** the XER text (Timeline's buildXER); `now` is the export's create/update date */
export function buildXERText(state: TLState, now: Date = new Date()): string {
  const xerDate = (iso: string, time: string) => iso + ' ' + time
  const tStart = (t: TLTask) => (t.milestone ? xerDate(t.start, '17:00') : xerDate(t.start, '08:00'))
  const tEnd = (t: TLTask) => (t.milestone ? xerDate(t.start, '17:00') : xerDate(toISO(taskEndDate(state, t)), '17:00'))
  const clean = (v: unknown) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')
  const getTrade = tradeResolver(state)
  const lines: string[] = []
  // Every table is written with P6's full column list (blank where we have nothing) because some
  // importers reject files missing standard columns.
  const table = (name: string, fields: string[], rows: XerRow[]) => {
    if (!rows.length) return
    lines.push('%T\t' + name)
    lines.push('%F\t' + fields.join('\t'))
    rows.forEach((r) => lines.push('%R\t' + fields.map((f) => clean(r[f])).join('\t')))
  }

  const PROJ = 1,
    CLNDR = 1,
    ROOT_WBS = 100,
    TRADE_TYPE = 1
  const shortName =
    (state.projectName || 'Programme')
      .replace(/[^A-Za-z0-9 \-_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || 'Programme'
  const starts = state.tasks.map((t) => t.start).sort()
  const projStart = starts[0] || toISO(now)
  const projEnd = state.tasks.map(tEnd).sort().pop() || xerDate(projStart, '17:00')
  const nowStr = xerDate(toISO(now), '00:00')

  // WBS: root project node, then one node per section that has tasks.
  const wbsOf = new Map<string, number>()
  const wbsRows: XerRow[] = [
    {
      wbs_id: ROOT_WBS,
      proj_id: PROJ,
      seq_num: 0,
      est_wt: 1,
      proj_node_flag: 'Y',
      sum_data_flag: 'N',
      status_code: 'WS_Open',
      wbs_short_name: shortName,
      wbs_name: state.projectName,
      parent_wbs_id: '',
      ev_user_pct: 6,
      ev_etc_user_value: 0.88,
      orig_cost: 0,
      indep_remain_total_cost: 0,
      indep_remain_work_qty: 0,
      ev_compute_type: 'EC_Cmp_pct',
      ev_etc_compute_type: 'EE_Rem_hr',
    },
  ]
  let seq = 0
  getRenderList(state, { forPrint: true, unfiltered: true }).forEach((item) => {
    if (item.type !== 'group' || item.empty) return
    const id = ROOT_WBS + wbsRows.length
    wbsOf.set(item.group.id, id)
    seq += 10
    wbsRows.push({ ...wbsRows[0], wbs_id: id, seq_num: seq, proj_node_flag: 'N', wbs_short_name: String(seq / 10), wbs_name: item.group.name, parent_wbs_id: ROOT_WBS })
  })

  // Trade activity code values.
  const trades = [...new Set(state.tasks.map((t) => t.trade).filter(Boolean))]
  const tradeCodeId = new Map(trades.map((name, i) => [name, 1 + i]))

  // Late dates / total float from the app's own backward pass, so the critical path survives even in
  // viewers that don't reschedule.
  const lateFinish = computeLateFinishes(state)
  const taskIdOf = new Map<string, number>()
  state.tasks.forEach((t, i) => taskIdOf.set(t.id, 1000 + i))
  const taskRows: XerRow[] = state.tasks.map((t, i) => {
    const hrs = t.milestone ? 0 : t.duration * 8
    const s = tStart(t),
      e = tEnd(t)
    const lf = lateFinish[t.id] || taskEndDate(state, t)
    const lfISO = toISO(lf)
    const ls = t.milestone ? xerDate(lfISO, '17:00') : xerDate(toISO(advanceWorkingDays(state, lf, -(t.duration - 1))), '08:00')
    const le = xerDate(lfISO, '17:00')
    const floatHrs = workingDaysBetween(state, taskEndDate(state, t), lf) * 8
    return {
      task_id: taskIdOf.get(t.id),
      proj_id: PROJ,
      wbs_id: (t.groupId && wbsOf.get(t.groupId)) || ROOT_WBS,
      clndr_id: CLNDR,
      phys_complete_pct: 0,
      rev_fdbk_flag: 'N',
      est_wt: 1,
      lock_plan_flag: 'N',
      auto_compute_act_flag: 'N',
      complete_pct_type: 'CP_Drtn',
      task_type: t.milestone ? 'TT_FinMile' : 'TT_Task',
      duration_type: 'DT_FixedDUR2',
      status_code: 'TK_NotStart',
      task_code: 'A' + (1000 + (i + 1) * 10),
      task_name: t.name,
      total_float_hr_cnt: floatHrs,
      remain_drtn_hr_cnt: hrs,
      target_drtn_hr_cnt: hrs,
      act_work_qty: 0,
      remain_work_qty: 0,
      target_work_qty: 0,
      target_equip_qty: 0,
      act_equip_qty: 0,
      remain_equip_qty: 0,
      cstr_date: s,
      cstr_type: 'CS_MSOA',
      early_start_date: s,
      early_end_date: e,
      late_start_date: ls,
      late_end_date: le,
      rem_late_start_date: ls,
      rem_late_end_date: le,
      restart_date: s,
      reend_date: e,
      target_start_date: s,
      target_end_date: e,
      priority_type: 'PT_Normal',
      driving_path_flag: floatHrs <= 0 ? 'Y' : 'N',
      act_this_per_work_qty: 0,
      act_this_per_equip_qty: 0,
      create_date: nowStr,
      update_date: nowStr,
      create_user: 'admin',
      update_user: 'admin',
    }
  })

  const predType: Record<string, string> = { FS: 'PR_FS', SS: 'PR_SS', FF: 'PR_FF' }
  const predRows: XerRow[] = []
  state.tasks.forEach((t) =>
    (t.predecessors || []).forEach((p) => {
      if (!taskIdOf.has(p.id)) return
      predRows.push({
        task_pred_id: predRows.length + 1,
        task_id: taskIdOf.get(t.id),
        pred_task_id: taskIdOf.get(p.id),
        proj_id: PROJ,
        pred_proj_id: PROJ,
        pred_type: predType[p.type] || 'PR_FS',
        lag_hr_cnt: (p.lag || 0) * 8,
      })
    }),
  )

  // Mon–Fri, 08:00–12:00 + 13:00–17:00. Day 1 = Sunday.
  const workDay = '(0||0(s|08:00|f|12:00)()) (0||1(s|13:00|f|17:00)())'
  let days = ''
  for (let d = 1; d <= 7; d++) days += ' (0||' + d + '()(' + (d === 1 || d === 7 ? '' : ' ' + workDay + ' ') + '))'
  const clndrData = '(0||CalendarData()( (0||DaysOfWeek()(' + days + ' )) (0||VIEW(ShowTotal|Y)()) (0||Exceptions()())))'

  lines.push(['ERMHDR', '19.12', toISO(now), 'Project', 'admin', 'du Boulay Timeline', 'dbxDatabaseNoName', 'Project Management', 'GBP'].join('\t'))
  table(
    'CURRTYPE',
    [
      'curr_id',
      'decimal_digit_cnt',
      'curr_symbol',
      'decimal_symbol',
      'digit_group_symbol',
      'pos_curr_fmt_type',
      'neg_curr_fmt_type',
      'curr_type',
      'curr_short_name',
      'group_digit_cnt',
      'base_exch_rate',
    ],
    [
      {
        curr_id: 1,
        decimal_digit_cnt: 2,
        curr_symbol: '£',
        decimal_symbol: '.',
        digit_group_symbol: ',',
        pos_curr_fmt_type: '#1.1',
        neg_curr_fmt_type: '(#1.1)',
        curr_type: 'British Pound',
        curr_short_name: 'GBP',
        group_digit_cnt: 3,
        base_exch_rate: 1,
      },
    ],
  )
  table(
    'CALENDAR',
    [
      'clndr_id',
      'default_flag',
      'clndr_name',
      'proj_id',
      'base_clndr_id',
      'last_chng_date',
      'clndr_type',
      'day_hr_cnt',
      'week_hr_cnt',
      'month_hr_cnt',
      'year_hr_cnt',
      'rsrc_private',
      'clndr_data',
    ],
    [
      {
        clndr_id: CLNDR,
        default_flag: 'N',
        clndr_name: 'Standard 5 Day',
        proj_id: PROJ,
        base_clndr_id: '',
        last_chng_date: nowStr,
        clndr_type: 'CA_Project',
        day_hr_cnt: 8,
        week_hr_cnt: 40,
        month_hr_cnt: 172,
        year_hr_cnt: 2000,
        rsrc_private: 'N',
        clndr_data: clndrData,
      },
    ],
  )
  table(
    'PROJECT',
    [
      'proj_id',
      'fy_start_month_num',
      'rsrc_self_add_flag',
      'allow_complete_flag',
      'rsrc_multi_assign_flag',
      'checkout_flag',
      'project_flag',
      'step_complete_flag',
      'cost_qty_recalc_flag',
      'batch_sum_flag',
      'name_sep_char',
      'def_complete_pct_type',
      'proj_short_name',
      'acct_id',
      'orig_proj_id',
      'source_proj_id',
      'base_type_id',
      'clndr_id',
      'sum_base_proj_id',
      'task_code_base',
      'task_code_step',
      'priority_num',
      'wbs_max_sum_level',
      'strgy_priority_num',
      'last_checksum',
      'critical_drtn_hr_cnt',
      'def_cost_per_qty',
      'last_recalc_date',
      'plan_start_date',
      'plan_end_date',
      'scd_end_date',
      'add_date',
      'last_tasksum_date',
      'fcst_start_date',
      'def_duration_type',
      'task_code_prefix',
      'guid',
      'def_qty_type',
      'add_by_name',
      'web_local_root_path',
      'proj_url',
      'def_rate_type',
      'add_act_remain_flag',
      'act_this_per_link_flag',
      'def_task_type',
      'act_pct_link_flag',
      'critical_path_type',
      'task_code_prefix_flag',
      'def_rollup_dates_flag',
      'use_project_baseline_flag',
      'rem_target_link_flag',
      'reset_planned_flag',
      'allow_neg_act_flag',
      'sum_assign_level',
      'last_fin_dates_id',
      'fintmpl_id',
      'last_baseline_update_date',
      'cr_external_key',
      'apply_actuals_date',
      'location_id',
      'last_schedule_date',
      'loaded_scope_level',
      'export_flag',
      'new_fin_dates_id',
      'baselines_to_export',
      'baseline_names_to_export',
      'next_data_date',
      'close_period_flag',
      'sum_refresh_date',
      'trsrcsum_loaded',
      'sumtask_loaded',
    ],
    [
      {
        proj_id: PROJ,
        fy_start_month_num: 4,
        rsrc_self_add_flag: 'Y',
        allow_complete_flag: 'Y',
        rsrc_multi_assign_flag: 'Y',
        checkout_flag: 'N',
        project_flag: 'Y',
        step_complete_flag: 'N',
        cost_qty_recalc_flag: 'N',
        batch_sum_flag: 'Y',
        name_sep_char: '.',
        def_complete_pct_type: 'CP_Drtn',
        proj_short_name: shortName,
        clndr_id: CLNDR,
        task_code_base: 1000,
        task_code_step: 10,
        priority_num: 10,
        wbs_max_sum_level: 0,
        strgy_priority_num: 100,
        critical_drtn_hr_cnt: 0,
        def_cost_per_qty: 0,
        last_recalc_date: xerDate(projStart, '08:00'),
        plan_start_date: xerDate(projStart, '08:00'),
        plan_end_date: projEnd,
        scd_end_date: projEnd,
        add_date: nowStr,
        def_duration_type: 'DT_FixedDUR2',
        task_code_prefix: 'A',
        def_qty_type: 'QT_Hour',
        add_by_name: 'admin',
        def_rate_type: 'COST_PER_QTY',
        add_act_remain_flag: 'N',
        act_this_per_link_flag: 'Y',
        def_task_type: 'TT_Task',
        act_pct_link_flag: 'N',
        critical_path_type: 'CT_TotFloat',
        task_code_prefix_flag: 'Y',
        def_rollup_dates_flag: 'Y',
        use_project_baseline_flag: 'Y',
        rem_target_link_flag: 'Y',
        reset_planned_flag: 'N',
        allow_neg_act_flag: 'N',
        sum_assign_level: 'SL_Taskrsrc',
        last_schedule_date: xerDate(projStart, '08:00'),
        loaded_scope_level: 7,
        export_flag: 'Y',
        close_period_flag: 'N',
        trsrcsum_loaded: 'N',
        sumtask_loaded: 'N',
      },
    ],
  )
  table(
    'SCHEDOPTIONS',
    [
      'schedoptions_id',
      'proj_id',
      'sched_outer_depend_type',
      'sched_open_critical_flag',
      'sched_lag_early_start_flag',
      'sched_retained_logic',
      'sched_setplantoforecast',
      'sched_float_type',
      'sched_calendar_on_relationship_lag',
      'sched_use_expect_end_flag',
      'sched_progress_override',
      'sched_level_float_thrs_cnt',
      'sched_level_outer_assign_flag',
      'sched_level_outer_assign_priority',
      'sched_level_over_all_rsrc',
      'sched_level_within_float',
      'sched_level_keep_sched_date_flag',
      'sched_level_all_rsrc_flag',
      'sched_use_project_end_date_for_float',
      'enable_multiple_longest_path_calc',
      'limit_multiple_longest_path_calc',
      'max_multiple_longest_path',
      'use_total_float_multiple_longest_paths',
      'key_activity_for_multiple_longest_paths',
      'LevelPriorityList',
    ],
    [
      {
        schedoptions_id: 1,
        proj_id: PROJ,
        sched_outer_depend_type: 'SD_Both',
        sched_open_critical_flag: 'N',
        sched_lag_early_start_flag: 'N',
        sched_retained_logic: 'Y',
        sched_setplantoforecast: 'N',
        sched_float_type: 'FT_FF',
        sched_calendar_on_relationship_lag: 'rcal_Predecessor',
        sched_use_expect_end_flag: 'Y',
        sched_progress_override: 'N',
        sched_level_float_thrs_cnt: 0,
        sched_level_outer_assign_flag: 'N',
        sched_level_outer_assign_priority: 1,
        sched_level_over_all_rsrc: 'N',
        sched_level_within_float: 'N',
        sched_level_keep_sched_date_flag: 'Y',
        sched_level_all_rsrc_flag: 'Y',
        sched_use_project_end_date_for_float: 'Y',
        enable_multiple_longest_path_calc: 'N',
        limit_multiple_longest_path_calc: 'N',
        max_multiple_longest_path: 10,
        use_total_float_multiple_longest_paths: 'Y',
        LevelPriorityList: 'priority_type,ASC',
      },
    ],
  )
  table(
    'PROJWBS',
    [
      'wbs_id',
      'proj_id',
      'obs_id',
      'seq_num',
      'est_wt',
      'proj_node_flag',
      'sum_data_flag',
      'status_code',
      'wbs_short_name',
      'wbs_name',
      'phase_id',
      'parent_wbs_id',
      'ev_user_pct',
      'ev_etc_user_value',
      'orig_cost',
      'indep_remain_total_cost',
      'ann_dscnt_rate_pct',
      'dscnt_period_type',
      'indep_remain_work_qty',
      'anticip_start_date',
      'anticip_end_date',
      'ev_compute_type',
      'ev_etc_compute_type',
      'guid',
      'tmpl_guid',
      'plan_open_state',
    ],
    wbsRows,
  )
  if (trades.length) {
    table(
      'ACTVTYPE',
      ['actv_code_type_id', 'actv_short_len', 'seq_num', 'actv_code_type', 'proj_id', 'wbs_id', 'actv_code_type_scope', 'super_flag'],
      [{ actv_code_type_id: TRADE_TYPE, actv_short_len: 20, seq_num: 10, actv_code_type: 'Trade', proj_id: PROJ, actv_code_type_scope: 'AS_Project', super_flag: 'N' }],
    )
    table(
      'ACTVCODE',
      ['actv_code_id', 'parent_actv_code_id', 'actv_code_type_id', 'actv_code_name', 'short_name', 'seq_num', 'color', 'total_assignments'],
      trades.map((name, i) => ({
        actv_code_id: tradeCodeId.get(name),
        parent_actv_code_id: '',
        actv_code_type_id: TRADE_TYPE,
        actv_code_name: name,
        short_name:
          name
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 20)
            .toUpperCase() || 'T' + (i + 1),
        seq_num: (i + 1) * 10,
        color: hexColor(getTrade(name).color),
        total_assignments: state.tasks.filter((t) => t.trade === name).length,
      })),
    )
  }
  table(
    'TASK',
    [
      'task_id',
      'proj_id',
      'wbs_id',
      'clndr_id',
      'phys_complete_pct',
      'rev_fdbk_flag',
      'est_wt',
      'lock_plan_flag',
      'auto_compute_act_flag',
      'complete_pct_type',
      'task_type',
      'duration_type',
      'status_code',
      'task_code',
      'task_name',
      'rsrc_id',
      'total_float_hr_cnt',
      'free_float_hr_cnt',
      'remain_drtn_hr_cnt',
      'act_work_qty',
      'remain_work_qty',
      'target_work_qty',
      'target_drtn_hr_cnt',
      'target_equip_qty',
      'act_equip_qty',
      'remain_equip_qty',
      'cstr_date',
      'act_start_date',
      'act_end_date',
      'late_start_date',
      'late_end_date',
      'expect_end_date',
      'early_start_date',
      'early_end_date',
      'restart_date',
      'reend_date',
      'target_start_date',
      'target_end_date',
      'rem_late_start_date',
      'rem_late_end_date',
      'cstr_type',
      'priority_type',
      'suspend_date',
      'resume_date',
      'float_path',
      'float_path_order',
      'guid',
      'tmpl_guid',
      'cstr_date2',
      'cstr_type2',
      'driving_path_flag',
      'act_this_per_work_qty',
      'act_this_per_equip_qty',
      'external_early_start_date',
      'external_late_end_date',
      'create_date',
      'update_date',
      'create_user',
      'update_user',
      'location_id',
    ],
    taskRows,
  )
  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt', 'comments', 'float_path', 'aref', 'arls'], predRows)
  table(
    'TASKACTV',
    ['task_id', 'actv_code_type_id', 'actv_code_id', 'proj_id'],
    state.tasks
      .filter((t) => tradeCodeId.has(t.trade))
      .map((t) => ({ task_id: taskIdOf.get(t.id), actv_code_type_id: TRADE_TYPE, actv_code_id: tradeCodeId.get(t.trade), proj_id: PROJ })),
  )
  lines.push('%E')
  return lines.join('\r\n') + '\r\n'
}

/** the .xer file as Windows-1252 bytes, ready for a Blob (Timeline's encodeCP1252(buildXER())) */
export const buildXER = (state: TLState, now: Date = new Date()): Uint8Array<ArrayBuffer> => encodeCP1252(buildXERText(state, now))

// ── FILE NAME / DOWNLOAD ──────────────────────────────────────────────────
/** ext includes any suffix, e.g. ' (MS Project).xml' or '.xer' */
export const exportFileName = (state: Pick<TLState, 'projectName'>, ext: string) => (state.projectName || 'programme').replace(/[^a-z0-9 \-_]/gi, '') + ext

export function downloadFile(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// convenience wrappers matching Timeline's Export menu
export const exportMSProject = (state: TLState) => downloadFile(exportFileName(state, ' (MS Project).xml'), buildMSProjectXML(state), 'application/xml')
export const exportXER = (state: TLState) => downloadFile(exportFileName(state, '.xer'), buildXER(state), 'application/octet-stream')
