import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export const DEFAULT_DB_PATH = join(homedir(), ".gaam", "gaam.db");

/** Search-indexed tables and the columns that feed the FTS title and body. */
const INDEXED: Record<string, { title: string; body: string }> = {
	goals: { title: "new.title", body: "coalesce(new.why,'') || ' ' || coalesce(new.metric,'')" },
	projects: {
		title: "new.key || ' ' || new.title",
		body: "coalesce(new.problem,'') || ' ' || coalesce(new.hypothesis,'') || ' ' || coalesce(new.description,'')",
	},
	tasks: { title: "new.key || ' ' || new.title", body: "coalesce(new.description,'') || ' ' || new.tags" },
	nodes: { title: "new.text", body: "coalesce(new.note,'')" },
	asks: { title: "new.question", body: "coalesce(new.why,'') || ' ' || coalesce(new.answer,'')" },
	comments: { title: "new.author", body: "new.body" },
	memories: { title: "new.topic", body: "new.fact" },
	journal: { title: "new.kind", body: "coalesce(new.body,'')" },
};

const MIGRATIONS: string[] = [
	`
	create table goals (
		id integer primary key,
		title text not null,
		why text,
		horizon text not null default 'quarter' check (horizon in ('week','month','quarter','year','life')),
		status text not null default 'active' check (status in ('active','paused','achieved','dropped')),
		metric text,
		target real,
		current real,
		due text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table projects (
		id integer primary key,
		key text not null unique,
		title text not null,
		goal_id integer references goals(id) on delete set null,
		stage text not null default 'idea'
			check (stage in ('idea','discovery','scoping','ready','active','shipped','archived')),
		problem text,
		hypothesis text,
		success_metric text,
		description text,
		color text,
		jira_project text,
		repo_path text,
		seq integer not null default 0,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table tasks (
		id integer primary key,
		key text not null unique,
		project_id integer references projects(id) on delete cascade,
		parent_id integer references tasks(id) on delete cascade,
		title text not null,
		description text,
		status text not null default 'todo'
			check (status in ('inbox','todo','doing','blocked','done','dropped')),
		scope text check (scope in ('in','out','later')),
		priority integer not null default 2 check (priority between 0 and 3),
		impact integer check (impact between 1 and 10),
		confidence integer check (confidence between 1 and 10),
		ease integer check (ease between 1 and 10),
		estimate_h real,
		actual_h real not null default 0,
		due text,
		tags text not null default '[]',
		jira_key text,
		branch text,
		sort real not null default 0,
		done_at text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	create index tasks_project on tasks(project_id, status);
	create index tasks_parent on tasks(parent_id);

	create table nodes (
		id integer primary key,
		project_id integer not null references projects(id) on delete cascade,
		parent_id integer references nodes(id) on delete cascade,
		text text not null,
		kind text not null default 'idea'
			check (kind in ('idea','question','risk','decision','insight','data','option','goal')),
		note text,
		task_id integer references tasks(id) on delete set null,
		sort real not null default 0,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	create index nodes_project on nodes(project_id);

	create table asks (
		id integer primary key,
		project_id integer references projects(id) on delete cascade,
		task_id integer references tasks(id) on delete cascade,
		question text not null,
		why text,
		kind text not null default 'text' check (kind in ('text','number','choice','data','confirm')),
		choices text,
		answer text,
		status text not null default 'open' check (status in ('open','answered','skipped')),
		asked_by text not null default 'agent',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		answered_at text
	);

	create table comments (
		id integer primary key,
		entity text not null check (entity in ('goal','project','task','node')),
		entity_id integer not null,
		author text not null default 'me',
		body text not null,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	create index comments_entity on comments(entity, entity_id);

	create table journal (
		id integer primary key,
		day text not null,
		kind text not null default 'note'
			check (kind in ('checkin','note','win','blocker','lesson','review')),
		energy integer check (energy between 1 and 5),
		mood integer check (mood between 1 and 5),
		body text,
		author text not null default 'me',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	create index journal_day on journal(day);

	create table day_plans (
		day text primary key,
		intention text,
		top text not null default '[]',
		reflection text,
		rating integer check (rating between 1 and 5),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table focus_sessions (
		id integer primary key,
		task_id integer references tasks(id) on delete set null,
		started_at text not null,
		ended_at text,
		minutes real,
		note text
	);

	create table memories (
		id integer primary key,
		topic text not null default 'context'
			check (topic in ('preference','pattern','context','value','skill','constraint','goal')),
		fact text not null,
		source text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table links (
		id integer primary key,
		task_id integer not null references tasks(id) on delete cascade,
		kind text not null check (kind in ('commit','mr','jira','url')),
		ref text not null,
		url text,
		title text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		unique (task_id, kind, ref)
	);

	create table counters (name text primary key, value integer not null);

	create table events (
		id integer primary key autoincrement,
		at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		actor text not null,
		action text not null,
		entity text,
		entity_id integer,
		summary text
	);

	create virtual table search using fts5(entity unindexed, entity_id unindexed, title, body, tokenize = 'unicode61');
	`,
	searchTriggers(),
	`
	alter table goals add column source text;
	alter table goals add column cycle text;
	alter table journal add column goal_id integer references goals(id) on delete set null;

	create table threads (
		id integer primary key,
		title text not null,
		provider text not null,
		model text,
		origin text not null default 'chat',
		session text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table messages (
		id integer primary key,
		thread_id integer not null references threads(id) on delete cascade,
		role text not null check (role in ('user','assistant','error')),
		content text not null,
		tools text not null default '[]',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	create index messages_thread on messages(thread_id, id);

	create table automations (
		id integer primary key,
		slug text unique,
		name text not null,
		schedule text not null,
		kind text not null check (kind in ('agent','jira_pull','git_sync')),
		prompt text,
		provider text,
		model text,
		enabled integer not null default 1,
		thread_id integer references threads(id) on delete set null,
		last_run_at text,
		last_status text,
		last_output text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table settings (key text primary key, value text not null);
	`,
	`
	alter table goals add column kind text check (kind in ('expectation','development'));

	create table people (
		id integer primary key,
		name text not null unique,
		role text,
		team text,
		relation text not null default 'peer'
			check (relation in ('manager','report','peer','product','stakeholder','other')),
		assessor integer not null default 0,
		cadence_days integer,
		notes text,
		last_contact_at text,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table interactions (
		id integer primary key,
		person_id integer not null references people(id) on delete cascade,
		day text not null,
		kind text not null check (kind in ('one_on_one','help','feedback_given','feedback_received','review','kudos','sync','social')),
		note text,
		goal_id integer references goals(id) on delete set null,
		author text not null default 'me',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	create index interactions_person on interactions(person_id, day);

	create table decisions (
		id integer primary key,
		project_id integer references projects(id) on delete set null,
		title text not null,
		context text,
		options text,
		choice text,
		impact text not null default 'low' check (impact in ('low','high')),
		reversible integer not null default 1,
		aligned_with text,
		status text not null default 'open' check (status in ('open','decided','revisited')),
		decided_at text,
		author text not null default 'me',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table standups (
		day text primary key,
		done text,
		next text,
		blockers text,
		help text,
		author text not null default 'me',
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create trigger people_ai after insert on people begin
		insert into search(entity, entity_id, title, body) values ('people', new.id, new.name, coalesce(new.role,'') || ' ' || coalesce(new.notes,''));
	end;
	create trigger decisions_ai after insert on decisions begin
		insert into search(entity, entity_id, title, body) values ('decisions', new.id, new.title, coalesce(new.context,'') || ' ' || coalesce(new.choice,''));
	end;
	`,
	`
	alter table tasks add column external_status text;
	alter table tasks add column external_since text;
	alter table tasks add column external_url text;
	`,
	`
	alter table people add column jira_user text;

	create table docs (
		id integer primary key,
		title text not null,
		kind text not null default 'note' check (kind in ('meeting','plan','doc','data','note','reference')),
		body text,
		summary text,
		source text,
		file_path text,
		mime text,
		day text,
		project_id integer references projects(id) on delete set null,
		tags text not null default '[]',
		author text not null default 'me',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);

	create table doc_people (
		doc_id integer not null references docs(id) on delete cascade,
		person_id integer not null references people(id) on delete cascade,
		primary key (doc_id, person_id)
	);

	create table followups (
		id integer primary key,
		person_id integer references people(id) on delete cascade,
		direction text not null default 'mine' check (direction in ('mine','theirs')),
		text text not null,
		due text,
		status text not null default 'open' check (status in ('open','done','dropped')),
		doc_id integer references docs(id) on delete set null,
		task_key text,
		author text not null default 'me',
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ')),
		done_at text
	);

	create trigger docs_ai after insert on docs begin
		insert into search(entity, entity_id, title, body) values ('docs', new.id, new.title, coalesce(new.summary,'') || ' ' || coalesce(new.body,''));
	end;
	create trigger docs_au after update on docs begin
		delete from search where entity = 'docs' and entity_id = old.id;
		insert into search(entity, entity_id, title, body) values ('docs', new.id, new.title, coalesce(new.summary,'') || ' ' || coalesce(new.body,''));
	end;
	create trigger docs_ad after delete on docs begin
		delete from search where entity = 'docs' and entity_id = old.id;
	end;
	create trigger followups_ai after insert on followups begin
		insert into search(entity, entity_id, title, body) values ('followups', new.id, new.direction, new.text);
	end;
	`,
	`
	create table workspaces (
		id integer primary key,
		key text not null unique,
		name text not null,
		icon text,
		color text,
		kind text not null default 'personal' check (kind in ('work','personal','other')),
		repos text not null default '[]',
		github_user text,
		sort integer not null default 0,
		created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ'))
	);
	insert into workspaces (id, key, name, icon, color, kind, sort) values
		(1, 'snappfood', 'اسنپ‌فود', '🍔', '#f5a524', 'work', 0),
		(2, 'personal', 'شخصی', '🌿', '#3ecf8e', 'personal', 1);

	alter table projects add column workspace_id integer references workspaces(id);
	alter table goals add column workspace_id integer references workspaces(id);
	alter table tasks add column workspace_id integer references workspaces(id);
	alter table docs add column workspace_id integer references workspaces(id);
	alter table people add column workspace_id integer references workspaces(id);
	alter table followups add column workspace_id integer references workspaces(id);
	alter table decisions add column workspace_id integer references workspaces(id);
	update projects set workspace_id = 1;
	update goals set workspace_id = 1;
	update tasks set workspace_id = coalesce((select workspace_id from projects p where p.id = tasks.project_id), 1);
	update docs set workspace_id = 1;
	update people set workspace_id = 1;
	update followups set workspace_id = 1;
	update decisions set workspace_id = 1;
	create index tasks_workspace on tasks(workspace_id, status);
	`,
	`
	alter table messages add column parts text not null default '[]';
	alter table messages add column meta text not null default '{}';
	alter table threads add column native text;
	alter table threads add column workspace text;
	alter table threads add column effort text;
	alter table threads add column pinned integer not null default 0;
	`,
];

function searchTriggers(): string {
	return Object.entries(INDEXED)
		.map(([table, { title, body }]) => {
			const insert = `insert into search(entity, entity_id, title, body) values ('${table}', new.id, ${title}, ${body});`;
			const remove = `delete from search where entity = '${table}' and entity_id = old.id;`;
			return `
			create trigger ${table}_ai after insert on ${table} begin ${insert} end;
			create trigger ${table}_au after update on ${table} begin ${remove} ${insert} end;
			create trigger ${table}_ad after delete on ${table} begin ${remove} end;`;
		})
		.join("\n");
}

export function openDb(path = process.env.GAAM_DB ?? DEFAULT_DB_PATH): Db {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
	migrate(db);
	return db;
}

function migrate(db: Db) {
	const { user_version: version } = db.prepare("pragma user_version").get() as { user_version: number };
	for (let i = version; i < MIGRATIONS.length; i++) {
		tx(db, () => {
			db.exec(MIGRATIONS[i]!);
			db.exec(`pragma user_version = ${i + 1}`);
		});
	}
}

export function tx<T>(db: Db, fn: () => T): T {
	if (db.isTransaction) return fn();
	db.exec("begin immediate");
	try {
		const result = fn();
		db.exec("commit");
		return result;
	} catch (error) {
		db.exec("rollback");
		throw error;
	}
}
