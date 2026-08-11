// Demo portfolio — the "one rich fixture" idea from plan.txt, toy-sized.
function seedData() {
  return {
    orgName: 'Acme IT PMO',
    /** Counters behind the generated PRG-#### / PRJ-#### identifiers. */
    seq: { program: 2, project: 3 },
    portfolios: [{ id: 'pf1', name: 'Enterprise IT' }],
    programs: [
      {
        id: 'pg1', portfolioId: 'pf1', name: 'Infrastructure Modernization',
        attrs: {
          programId: 'PRG-0001', description: 'Consolidate and modernize core infrastructure ahead of the lease exit.',
          strategicObjectives: 'Exit the Fremont data centre before lease expiry; cut infrastructure run-cost by 30%.',
          linkedObjectiveIds: ['ok1'],
          programManagerId: 'u3', sponsorId: 'u4',
          businessUnits: ['IT Operations', 'Business Applications'],
          strategicTheme: 'Cost reduction', status: 'active', priority: 'high',
          budget: 4200000, ytdSpend: 1150000, currency: 'USD',
          fundingSource: 'IT capital budget', roiTargetPct: 22,
          governanceCadence: 'monthly', startDate: '2026-07-20', targetEndDate: '2027-03-31',
        },
      },
      {
        id: 'pg2', portfolioId: 'pf1', name: 'Digital Workplace',
        attrs: {
          programId: 'PRG-0002', description: 'Modern collaboration and endpoint experience for all staff.',
          strategicObjectives: 'Raise workforce productivity through modern collaboration tooling.',
          linkedObjectiveIds: ['ok2'],
          programManagerId: 'u6', sponsorId: 'u4',
          businessUnits: ['End User Services'],
          strategicTheme: 'Productivity', status: 'active', priority: 'medium',
          budget: 1800000, ytdSpend: 210000, currency: 'USD',
          fundingSource: 'IT operating budget', roiTargetPct: 15,
          governanceCadence: 'quarterly', startDate: '2026-09-01', targetEndDate: '2027-06-30',
        },
      },
    ],
    projects: [
      {
        id: 'p1', programId: 'pg1', name: 'Data Center Migration', status: 'active',
        attrs: {
          projectId: 'PRJ-0001', description: 'Migrate all tier-1 workloads out of the Fremont DC before lease expiry.',
          scopeStatement: 'In scope: 42 tier-1 applications, their databases, and supporting network and storage. Out of scope: tier-2/3 applications, end-user devices, and the DR site refresh.',
          projectManagerId: 'u1', sponsorId: 'u5',
          teamLeadIds: ['u2', 'u7'], crossFunctionalIds: ['u11', 'u10'], smeIds: ['u14', 'u9', 'u13'],
          businessUnit: 'IT Operations',
          investmentType: 'transform', methodology: 'hybrid', priority: 'critical', phase: 'execution',
          targetStartDate: '2026-07-20', targetFinishDate: '2026-09-15',
          budget: 2400000, currency: 'USD', acwp: 615000, contingencyReserve: 240000, costType: 'capex',
          expectedBenefit: 'Avoid $1.1M/yr lease + 30% power savings', benefitType: 'cost-avoidance',
          complianceFlags: 'SOX', riskTolerance: 'low',
          jiraProjectKey: 'DCM', confluenceSpace: 'INFRA',
        },
      },
      {
        id: 'p2', programId: 'pg1', name: 'Network Refresh', status: 'active',
        attrs: {
          projectId: 'PRJ-0002', description: 'Replace end-of-life switching across three sites.',
          scopeStatement: 'In scope: access and distribution layer switching at three sites. Out of scope: WAN circuits and firewalls.',
          projectManagerId: 'u2', sponsorId: 'u5',
          teamLeadIds: ['u8'], crossFunctionalIds: [], smeIds: ['u9'],
          businessUnit: 'IT Operations',
          investmentType: 'run', methodology: 'waterfall', priority: 'high', phase: 'planning',
          targetStartDate: '2026-07-27', targetFinishDate: '2026-09-30',
          budget: 780000, currency: 'USD', acwp: 240000, contingencyReserve: 78000, costType: 'capex',
          expectedBenefit: 'Remove EOL support risk', benefitType: 'risk-reduction',
          complianceFlags: '', riskTolerance: 'medium', jiraProjectKey: 'NET', confluenceSpace: 'INFRA',
        },
      },
      {
        id: 'p3', programId: 'pg2', name: 'O365 Rollout', status: 'draft',
        attrs: {
          projectId: 'PRJ-0003', description: 'Tenant build and phased staff migration.',
          scopeStatement: 'In scope: tenant build, pilot group, and phased migration of all staff mailboxes and files.',
          projectManagerId: 'u1', sponsorId: 'u6',
          teamLeadIds: ['u11'], crossFunctionalIds: ['u12'], smeIds: [],
          businessUnit: 'End User Services',
          investmentType: 'grow', methodology: 'agile', priority: 'medium', phase: 'initiation',
          targetStartDate: '2026-09-01', targetFinishDate: '2027-02-28',
          budget: 950000, currency: 'USD', acwp: 0, contingencyReserve: 95000, costType: 'opex',
          expectedBenefit: 'Retire legacy mail platform', benefitType: 'cost-saving',
          complianceFlags: 'GDPR', riskTolerance: 'medium', jiraProjectKey: 'DWP', confluenceSpace: 'DWP',
        },
      },
    ],
    plans: {
      p1: {
        start: '2026-07-20',
        tasks: [
          { id: 's1', name: 'Phase 1 — Discovery', kind: 'summary', parentId: null },
          { id: 't1', name: 'Inventory applications', kind: 'task', parentId: 's1', duration: 5, pct: 100 },
          { id: 't2', name: 'Dependency mapping', kind: 'task', parentId: 's1', duration: 4, pct: 100 },
          { id: 'm1', name: 'Discovery complete', kind: 'milestone', parentId: 's1', pct: 100 },
          { id: 's2', name: 'Phase 2 — Build', kind: 'summary', parentId: null },
          { id: 't3', name: 'Rack & network build-out', kind: 'task', parentId: 's2', duration: 10, pct: 60 },
          { id: 't4', name: 'Storage provisioning', kind: 'task', parentId: 's2', duration: 6, pct: 30 },
          { id: 't5', name: 'Security hardening', kind: 'task', parentId: 's2', duration: 5, pct: 0 },
          { id: 't13', name: 'Backup & DR validation', kind: 'task', parentId: 's2', duration: 4, pct: 0 },
          { id: 's3', name: 'Phase 3 — Migration', kind: 'summary', parentId: null },
          { id: 't6', name: 'Pilot app migration', kind: 'task', parentId: 's3', duration: 5, pct: 0 },
          { id: 't7', name: 'DB migration', kind: 'task', parentId: 's3', duration: 8, pct: 0 },
          { id: 't8', name: 'App wave 1', kind: 'task', parentId: 's3', duration: 6, pct: 0 },
          { id: 't9', name: 'App wave 2', kind: 'task', parentId: 's3', duration: 6, pct: 0 },
          { id: 't14', name: 'User comms & training', kind: 'task', parentId: 's3', duration: 4, pct: 0 },
          { id: 'm2', name: 'Go/No-Go', kind: 'milestone', parentId: 's3', pct: 0 },
          { id: 't10', name: 'Cutover & DNS switch', kind: 'task', parentId: 's3', duration: 2, pct: 0 },
          { id: 'm3', name: 'Migration complete (M3)', kind: 'milestone', parentId: 's3', pct: 0 },
          { id: 's4', name: 'Closeout', kind: 'summary', parentId: null },
          { id: 't11', name: 'Decommission legacy DC', kind: 'task', parentId: 's4', duration: 5, pct: 0 },
          { id: 't12', name: 'Lessons learned', kind: 'task', parentId: 's4', duration: 2, pct: 0 },
        ],
        deps: [
          { pred: 't1', succ: 't2', type: 'FS', lag: 0 },
          { pred: 't2', succ: 'm1', type: 'FS', lag: 0 },
          { pred: 'm1', succ: 't3', type: 'FS', lag: 0 },
          { pred: 't3', succ: 't4', type: 'SS', lag: 2 },
          { pred: 't4', succ: 't5', type: 'FS', lag: 0 },
          { pred: 't5', succ: 't6', type: 'FS', lag: 0 },
          { pred: 'm1', succ: 't13', type: 'FS', lag: 0 },
          { pred: 't13', succ: 't6', type: 'FS', lag: 0 },
          { pred: 't6', succ: 't14', type: 'FS', lag: 0 },
          { pred: 't14', succ: 'm2', type: 'FS', lag: 0 },
          { pred: 't6', succ: 't7', type: 'FS', lag: 0 },
          { pred: 't7', succ: 't8', type: 'SS', lag: 3 },
          { pred: 't8', succ: 't9', type: 'FS', lag: 0 },
          { pred: 't7', succ: 'm2', type: 'FS', lag: 0 },
          { pred: 't9', succ: 'm2', type: 'FS', lag: 0 },
          { pred: 'm2', succ: 't10', type: 'FS', lag: 0 },
          { pred: 't10', succ: 'm3', type: 'FS', lag: 0 },
          { pred: 'm3', succ: 't11', type: 'FS', lag: 0 },
          { pred: 't11', succ: 't12', type: 'FS', lag: 0 },
        ],
      },
      p2: {
        start: '2026-07-27',
        tasks: [
          { id: 'n1', name: 'Site survey', kind: 'task', parentId: null, duration: 4, pct: 100 },
          { id: 'n2', name: 'Switch procurement', kind: 'task', parentId: null, duration: 10, pct: 40 },
          { id: 'n3', name: 'Install & configure', kind: 'task', parentId: null, duration: 8, pct: 0 },
          { id: 'n4', name: 'Refresh complete', kind: 'milestone', parentId: null, pct: 0 },
        ],
        deps: [
          { pred: 'n1', succ: 'n2', type: 'FS', lag: 0 },
          { pred: 'n2', succ: 'n3', type: 'FS', lag: 0 },
          { pred: 'n3', succ: 'n4', type: 'FS', lag: 0 },
        ],
      },
      p3: {
        start: '2026-09-01',
        tasks: [
          { id: 'o1', name: 'Tenant setup', kind: 'task', parentId: null, duration: 3, pct: 0 },
          { id: 'o2', name: 'Pilot group', kind: 'task', parentId: null, duration: 5, pct: 0 },
        ],
        deps: [{ pred: 'o1', succ: 'o2', type: 'FS', lag: 0 }],
      },
    },
    /**
     * Fake corporate directory — stands in for LDAP/Entra/Okta federation.
     * `account` distinguishes people who log in from people who are merely
     * NAMED (sponsors, SMEs, vendor contacts). Directory-only people must
     * not consume a licence seat.
     */
    people: [
      { id: 'u1', name: 'Priya Nair', email: 'priya.nair@acme.com', title: 'Senior Project Manager', dept: 'IT Operations', account: 'login' },
      { id: 'u2', name: 'Marcus Webb', email: 'marcus.webb@acme.com', title: 'Infrastructure Lead', dept: 'IT Operations', account: 'login' },
      { id: 'u3', name: 'Rajesh Ramani', email: 'rajesh.ramani@acme.com', title: 'Program Director', dept: 'PMO', account: 'login' },
      { id: 'u4', name: 'Dana Whitfield', email: 'dana.whitfield@acme.com', title: 'CIO', dept: 'Executive', account: 'directory' },
      { id: 'u5', name: 'Tom Alvarez', email: 'tom.alvarez@acme.com', title: 'VP Infrastructure', dept: 'IT Operations', account: 'login' },
      { id: 'u6', name: 'Sofia Lindqvist', email: 'sofia.l@acme.com', title: 'Head of End User Services', dept: 'End User Services', account: 'login' },
      { id: 'u7', name: 'Ken Ito', email: 'ken.ito@acme.com', title: 'Database Architect', dept: 'IT Operations', account: 'login' },
      { id: 'u8', name: 'Amara Okafor', email: 'amara.okafor@acme.com', title: 'Network Engineer', dept: 'IT Operations', account: 'login' },
      { id: 'u9', name: 'Ben Straub', email: 'ben.straub@acme.com', title: 'Security Architect', dept: 'Information Security', account: 'login' },
      { id: 'u10', name: 'Lucia Moretti', email: 'lucia.moretti@acme.com', title: 'Finance Business Partner', dept: 'Finance', account: 'directory' },
      { id: 'u11', name: 'Hiro Tanaka', email: 'hiro.tanaka@acme.com', title: 'Change Manager', dept: 'PMO', account: 'login' },
      { id: 'u12', name: 'Grace Ferreira', email: 'grace.f@acme.com', title: 'Application Owner — ERP', dept: 'Business Applications', account: 'directory' },
      { id: 'u13', name: 'Omar Haddad', email: 'omar.haddad@vendorcorp.com', title: 'Vendor Delivery Manager', dept: 'External — VendorCorp', account: 'directory' },
      { id: 'u14', name: 'Elena Petrova', email: 'elena.petrova@acme.com', title: 'Storage SME', dept: 'IT Operations', account: 'login' },
    ],

    /** Attachments on programs and projects: uploaded file OR external link. */
    documents: [
      { id: 'd1', ownerType: 'program', ownerId: 'pg1', name: 'Program Charter', description: 'Signed charter, v2', kind: 'link', url: 'https://confluence.acme.com/display/INFRA/Charter', addedBy: 'u3', addedAt: '2026-07-02' },
      { id: 'd2', ownerType: 'project', ownerId: 'p1', name: 'Migration Runbook', description: 'Cutover steps and rollback', kind: 'link', url: 'https://confluence.acme.com/display/INFRA/Runbook', addedBy: 'u1', addedAt: '2026-07-28' },
    ],

    /** Configurable pick-lists (org settings in production). */
    businessUnits: ['IT Operations', 'End User Services', 'Business Applications', 'Information Security', 'Finance', 'HR', 'Manufacturing', 'Sales'],
    fundingSources: ['IT capital budget', 'IT operating budget', 'Business unit chargeback', 'Corporate transformation fund', 'External grant', 'Vendor financed'],
    cancelReasons: ['Business priorities changed', 'Funding withdrawn', 'Scope absorbed by another project', 'Benefit no longer valid', 'Vendor/supplier failure', 'Resource unavailability', 'Regulatory or compliance change'],

    resources: [
      { id: 'r1', name: 'Priya', personId: 'u1' },
      { id: 'r2', name: 'Marcus', personId: 'u2' },
      { id: 'r3', name: 'Senior DBA (role)', personId: null },
      { id: 'r4', name: 'Network Team', personId: null },
    ],
    assignments: [
      { taskId: 't3', resourceId: 'r4', units: 100 },
      { taskId: 't4', resourceId: 'r2', units: 50 },
      { taskId: 't7', resourceId: 'r3', units: 100 },
      { taskId: 't6', resourceId: 'r1', units: 100 },
    ],
    risks: [
      { id: 'rk1', projectId: 'p1', title: 'Storage vendor delivery slips', category: 'vendor', probability: 4, impact: 4, status: 'mitigating', owner: 'Marcus', source: 'human', mitigation: 'Weekly vendor checkpoint; identified alternate supplier.' },
      { id: 'rk2', projectId: 'p1', title: 'Legacy app has undocumented dependencies', category: 'technical', probability: 3, impact: 4, status: 'open', owner: 'Priya', source: 'human', mitigation: '' },
    ],
    actionItems: [
      { id: 'a1', projectId: 'p1', title: 'Confirm firewall rules with network team', owner: 'Marcus', due: '2026-08-05', status: 'open', blockedTaskIds: ['t5'], source: 'meeting' },
      { id: 'a2', projectId: 'p1', title: 'Get DBA capacity commitment for migration window', owner: 'Priya', due: '2026-08-12', status: 'open', blockedTaskIds: ['t7'], source: 'meeting' },
      { id: 'a3', projectId: 'p1', title: 'Book cutover change window with CAB', owner: 'Rajesh', due: '2026-08-21', status: 'open', blockedTaskIds: ['t10'], source: 'manual' },
    ],
    meetingNotes: [
      {
        id: 'mn1', projectId: 'p1', date: '2026-08-04',
        body: 'Weekly sync. Rack build on track but storage vendor hinted at a 1-week delivery slip — Marcus to confirm firewall rules with the network team by Friday. Priya raised that we still lack a DBA capacity commitment for the migration window; she will chase. Need to book the CAB change window for cutover.',
      },
    ],
    checkIns: [
      { id: 'c1', projectId: 'p1', author: 'Priya', date: '2026-07-31', body: 'Discovery wrapped. Build phase started; a little worried about storage lead times but rack work is moving.' },
      { id: 'c2', projectId: 'p1', author: 'Marcus', date: '2026-08-06', body: 'Vendor is being cagey about the storage delivery date again. Everything else on plan, but if it slips the whole migration phase moves.' },
    ],
    // OKRs — tiered executive → org, with programs linked to key results.
    // Sketch for ideation; not yet in the domain model.
    okrs: [
      {
        id: 'ok1', tier: 'executive', parentId: null, owner: 'CIO', period: 'FY26',
        title: 'Cut IT run-cost and modernize the estate',
        keyResults: [
          { id: 'kr1', title: 'Reduce data-center footprint by 40%', target: 40, current: 15, unit: '%', programIds: ['pg1'] },
          { id: 'kr2', title: 'Achieve 99.95% platform uptime', target: 99.95, current: 99.91, unit: '%', programIds: ['pg1'] },
        ],
      },
      {
        id: 'ok2', tier: 'executive', parentId: null, owner: 'CIO', period: 'FY26',
        title: 'Improve workforce productivity through modern tooling',
        keyResults: [
          { id: 'kr3', title: 'Migrate 100% of staff to the new collaboration suite', target: 100, current: 10, unit: '%', programIds: ['pg2'] },
        ],
      },
      {
        id: 'ok3', tier: 'org', parentId: 'ok1', owner: 'Infrastructure', period: 'FY26',
        title: 'Exit the legacy data center',
        keyResults: [
          { id: 'kr4', title: 'Migrate all tier-1 applications', target: 100, current: 35, unit: '%', programIds: ['pg1'] },
          { id: 'kr5', title: 'Decommission legacy hardware', target: 100, current: 0, unit: '%', programIds: ['pg1'] },
        ],
      },
    ],

    // Seeded agent proposals — propose-don't-impose, every one carries evidence
    agentInbox: [
      {
        id: 'ar1', agent: 'Action Item Agent', kind: 'action-item', status: 'proposed',
        proposal: { title: 'Chase DBA capacity commitment', owner: 'Priya', due: '2026-08-12', blockedTaskIds: ['t7'] },
        evidence: '"Priya raised that we still lack a DBA capacity commitment for the migration window; she will chase." — meeting note, Aug 4',
      },
      {
        id: 'ar2', agent: 'Risk Agent', kind: 'risk', status: 'proposed',
        proposal: { title: 'DBA availability shortfall during migration window', category: 'resource', probability: 3, impact: 4 },
        evidence: 'Leading indicator: t7 (DB migration) is critical with a single role-resource assignment; 2 of 3 similar historic projects realized a staffing risk in the migration phase.',
      },
      {
        id: 'ar3', agent: 'Reporting Agent', kind: 'report', status: 'proposed',
        proposal: {
          rag: 'amber',
          highlights: ['Discovery complete on schedule', 'Rack & network build-out 60% done'],
          lowlights: ['Storage vendor delivery at risk (rk1)', 'DBA capacity unconfirmed for migration window'],
          sentiment: 'Check-in tone trending anxious (−1) while status is Amber — watch for Green-but-anxious divergence.',
          asks: ['Escalate vendor delivery date to procurement', 'Confirm DBA allocation'],
        },
        evidence: 'Sources: check-ins c1, c2; risk rk1; schedule float on critical path.',
      },
    ],
  };
}
