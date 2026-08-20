"""
Seed realistic Dayflow activity so the gated views (Daily / Weekly / Chat) can be
exercised without waiting days for real capture.

Everything written here is tagged (card metadata.seed = true, observations
llm_model = 'seed', batches llm_metadata = "seed", screenshots file_size = -1),
so `python scripts/seed-test-data.py --clear` removes it and leaves real
captured data untouched.

Run with the Dayflow app CLOSED.
"""
import sqlite3, os, sys, json, uuid, random
from datetime import datetime, timedelta, date

DB = os.path.join(os.environ['APPDATA'], 'dayflow-win', 'chunks.sqlite')
rng = random.Random(20260820)


def ts(dt):
    return int(dt.timestamp())


def hmma(dt):
    h = dt.hour % 12 or 12
    return "%d:%02d %s" % (h, dt.minute, 'AM' if dt.hour < 12 else 'PM')


def logical_day(dt):
    d = dt - timedelta(days=1) if dt.hour < 4 else dt
    return d.strftime('%Y-%m-%d')


def B(cat, title, summary, detail, prim, sec, mins, distractions=None):
    return dict(cat=cat, title=title, summary=summary, detail=detail,
                prim=prim, sec=sec, mins=mins, distractions=distractions or [])


IDLE = lambda mins: B('Idle', 'Idle', 'You were idle during this period.',
                      'Idle period. Dayflow skipped activity summarization for this block.',
                      None, None, mins)

DAY_TEMPLATES = {
    # ---- richest day: exercises every category, used for "yesterday" ----
    'rich': ((9, 10), [
        B('Communication', 'Cleared the morning inbox and replied to the CS 135 group thread',
          'Worked through overnight email and answered the group chat about the Friday deadline. Confirmed who is handling the testing section before switching to code.',
          '9:10 AM - 9:22 AM: read and archived 14 emails in Gmail\n9:22 AM - 9:31 AM: replied to the CS 135 group chat in Discord about deliverables\n9:31 AM - 9:40 AM: added the Friday deadline to the shared doc',
          'mail.google.com', 'discord.com', 32),
        B('Personal Projects', 'Fixed the Dayflow timeline card overlap bug',
          'Tracked down why two cards were stacking on the day canvas and rewrote the overlap trim so the shorter card always wins. Verified against a day with three overlapping ranges.',
          '9:45 AM - 10:05 AM: read layout.ts positionCards in VS Code, added logging\n10:05 AM - 10:28 AM: rewrote the overlap loop, ran the app to verify\n10:28 AM - 10:52 AM: cleaned up the fix and committed',
          'code.visualstudio.com', 'github.com', 70,
          [dict(title='Checked X', summary='Scrolled the timeline for a few minutes mid-debug.')]),
        B('Studying', 'Worked through the dynamic programming lecture on knapsack',
          'Watched the recorded lecture on 0/1 knapsack and rebuilt the memo table by hand until the recurrence made sense. Took notes on when tabulation beats memoization.',
          '11:00 AM - 11:25 AM: watched the DP lecture recording at 1.5x\n11:25 AM - 11:48 AM: worked the knapsack example by hand in Notion\n11:48 AM - 12:05 PM: added notes comparing memo vs tabulation',
          'notion.so', 'youtube.com', 65),
        IDLE(45),
        B('Assignments', 'Finished the CS 135 problem set and submitted it',
          'Closed out the last two proofs on the problem set, checked the edge cases against the lecture notes, and submitted the PDF with 20 minutes to spare.',
          '12:55 PM - 1:20 PM: wrote the question 4 proof in Overleaf\n1:20 PM - 1:48 PM: fixed the induction step after re-reading notes\n1:48 PM - 2:05 PM: exported the PDF and submitted on the course portal',
          'overleaf.com', 'notion.so', 72),
        B('Distraction', 'YouTube and Reddit break',
          'Scrolled YouTube recommendations and the programming subreddit after submitting the problem set.',
          '2:10 PM - 2:22 PM: watched two YouTube videos\n2:22 PM - 2:34 PM: scrolled r/programming',
          'youtube.com', 'reddit.com', 26),
        B('Personal Projects', 'Wired the Claude CLI provider into the Dayflow Windows port',
          'Added the subprocess provider so the app runs on a Claude subscription instead of an API key, then tested transcription end to end on a real batch.',
          '2:40 PM - 3:10 PM: wrote the claudeCli.ts provider and JSON parsing\n3:10 PM - 3:38 PM: wired it into the provider registry and settings\n3:38 PM - 4:05 PM: ran a live batch and watched the card generate',
          'code.visualstudio.com', 'claude.ai', 88,
          [dict(title='Discord ping', summary='Answered a message from SAI about the port.')]),
        B('Content Creation', 'Scripted the Dayflow Windows demo video',
          'Drafted the walkthrough script for the port demo and picked which screens to record. Storyboarded the timeline and weekly views as the opening shots.',
          '4:15 PM - 4:38 PM: drafted the script outline in Google Docs\n4:38 PM - 5:02 PM: listed the screen recordings needed\n5:02 PM - 5:15 PM: rough timing pass on the intro',
          'docs.google.com', 'capcut.com', 62),
        B('Personal', 'Planned the weekend and sorted out gym scheduling',
          'Booked the Saturday class, moved a lift day around a group meeting, and cleared the calendar conflicts for the weekend.',
          '5:30 PM - 5:45 PM: booked the Saturday class\n5:45 PM - 5:58 PM: rescheduled two calendar events',
          'calendar.google.com', None, 30),
        B('Personal Projects', 'Debugged the media protocol so slideshow frames load',
          'Chased down why every timelapse frame rendered black and found the drive letter was being parsed as the URL host. Fixed the URL builder and confirmed frames play.',
          '7:20 PM - 7:45 PM: reproduced the black frames in an isolated Electron test\n7:45 PM - 8:10 PM: fixed the protocol handler and URL builder\n8:10 PM - 8:32 PM: rebuilt and verified the slideshow',
          'code.visualstudio.com', 'github.com', 74),
        B('Distraction', 'Scrolling before bed',
          'Scrolled Instagram and YouTube shorts before shutting down for the night.',
          '9:00 PM - 9:18 PM: Instagram reels\n9:18 PM - 9:30 PM: YouTube shorts',
          'instagram.com', 'youtube.com', 32),
    ]),
    # ---- heavy build day ----
    'build': ((9, 40), [
        B('Communication', 'Stand-up notes and replies to the hackathon team',
          'Posted the morning update in the team channel and answered two questions about the API contract before starting on the build.',
          '9:40 AM - 9:55 AM: posted the update in Discord\n9:55 AM - 10:08 AM: answered API questions',
          'discord.com', 'github.com', 30),
        B('Personal Projects', 'Built the TidalTasks scheduling endpoint',
          'Added the endpoint that turns a task list into a scheduled day, including the conflict check against existing calendar blocks. Wrote tests around the overlap case.',
          '10:15 AM - 10:50 AM: sketched the scheduling algorithm\n10:50 AM - 11:30 AM: implemented the endpoint\n11:30 AM - 11:58 AM: wrote tests for the conflict path',
          'code.visualstudio.com', 'github.com', 105,
          [dict(title='Quick X check', summary='Two minutes on the timeline mid-build.')]),
        B('Studying', 'Read up on interval scheduling algorithms',
          'Read through the greedy interval scheduling proof to make sure the endpoint picks the right ordering. Compared it against the weighted variant.',
          '12:05 PM - 12:30 PM: read the greedy scheduling notes\n12:30 PM - 12:52 PM: worked an example by hand',
          'notion.so', 'wikipedia.org', 55),
        IDLE(50),
        B('Personal Projects', 'Hooked the scheduler up to the front end',
          'Wired the new endpoint into the React front end and got the generated schedule rendering in the day view. Fixed two timezone bugs on the way.',
          '1:50 PM - 2:25 PM: added the fetch layer and types\n2:25 PM - 3:00 PM: rendered the schedule in the day view\n3:00 PM - 3:22 PM: fixed timezone offsets',
          'code.visualstudio.com', 'localhost', 95),
        B('Distraction', 'YouTube break',
          'Watched a couple of dev videos between the front end work and the assignment.',
          '3:30 PM - 3:52 PM: watched two YouTube videos', 'youtube.com', None, 28),
        B('Assignments', 'Started the linear algebra assignment',
          'Set up the first three eigenvalue questions and got through the computation for two of them before stopping for the day.',
          '4:05 PM - 4:40 PM: set up questions 1 through 3\n4:40 PM - 5:10 PM: computed eigenvalues for the first two',
          'overleaf.com', 'wolframalpha.com', 70),
        B('Personal', 'Groceries and life admin',
          'Ordered groceries for the week and paid the phone bill.',
          '5:20 PM - 5:38 PM: grocery order\n5:38 PM - 5:50 PM: paid the phone bill',
          'amazon.ca', None, 35),
        B('Personal Projects', 'Cleaned up the repo and opened a PR',
          'Squashed the scheduling work into a clean branch, wrote the PR description, and pushed it up for review.',
          '7:40 PM - 8:05 PM: rebased and squashed commits\n8:05 PM - 8:25 PM: wrote the PR description and pushed',
          'github.com', 'code.visualstudio.com', 55),
    ]),
    # ---- study-heavy day ----
    'study': ((8, 50), [
        B('Studying', 'Reviewed the midterm slide decks end to end',
          'Went through all six lecture decks flagged for the midterm and marked the sections that still felt shaky. Built a shortlist of topics to drill.',
          '8:50 AM - 9:30 AM: reviewed decks 1 through 3\n9:30 AM - 10:05 AM: reviewed decks 4 through 6\n10:05 AM - 10:20 AM: listed the weak topics',
          'notion.so', 'drive.google.com', 90),
        B('Communication', 'Office hours question about the midterm scope',
          'Emailed the professor to confirm whether the last chapter is in scope and coordinated a study session with two classmates.',
          '10:30 AM - 10:45 AM: emailed the professor\n10:45 AM - 11:00 AM: set up the study session',
          'mail.google.com', 'discord.com', 30),
        B('Studying', 'Drilled practice problems on the weak topics',
          'Worked through the practice set on change of basis until the steps stopped needing the notes. Redid the two problems that went wrong the first time.',
          '11:05 AM - 11:45 AM: change of basis practice set\n11:45 AM - 12:20 PM: redid the two missed problems',
          'wolframalpha.com', 'notion.so', 78),
        IDLE(55),
        B('Assignments', 'Wrote the lab report discussion section',
          'Drafted the discussion for the lab report, pulled the two figures in, and tightened the conclusion down to a paragraph.',
          '1:25 PM - 2:00 PM: drafted the discussion\n2:00 PM - 2:35 PM: added figures and captions\n2:35 PM - 2:52 PM: tightened the conclusion',
          'docs.google.com', 'drive.google.com', 88),
        B('Distraction', 'Reddit and YouTube',
          'Scrolled Reddit and watched a video after finishing the lab report draft.',
          '3:00 PM - 3:20 PM: r/uwaterloo\n3:20 PM - 3:34 PM: YouTube',
          'reddit.com', 'youtube.com', 34),
        B('Studying', 'Second pass on the shaky midterm topics',
          'Went back through the flagged sections with fresh notes and got the projection matrix derivation to stick.',
          '3:45 PM - 4:20 PM: reworked the projection derivation\n4:20 PM - 4:50 PM: summarized it into the cheat sheet',
          'notion.so', None, 68),
        B('Personal', 'Dinner break and messages',
          'Caught up on family messages over dinner.',
          '5:00 PM - 5:25 PM: replied to messages', 'web.whatsapp.com', None, 30),
        B('Studying', 'Built the one-page cheat sheet',
          'Condensed six decks of notes onto a single page and rewrote the formulas so they stay readable under time pressure.',
          '7:30 PM - 8:05 PM: laid out the cheat sheet\n8:05 PM - 8:30 PM: rewrote the formula section',
          'notion.so', 'docs.google.com', 62),
    ]),
    # ---- collaboration / content day ----
    'collab': ((9, 25), [
        B('Communication', 'Team sync about the hackathon submission',
          'Ran through the remaining scope with the team on a call and split the last three tasks. Agreed to freeze features Thursday night.',
          '9:25 AM - 10:00 AM: call with the team\n10:00 AM - 10:15 AM: wrote up the task split',
          'discord.com', 'docs.google.com', 52),
        B('Personal Projects', 'Built the submission demo flow',
          'Put together the click-through demo path for the judges so nothing depends on live data. Hardcoded two fixtures where the API is flaky.',
          '10:25 AM - 11:05 AM: built the demo path\n11:05 AM - 11:40 AM: added fixtures for the flaky endpoints',
          'code.visualstudio.com', 'localhost', 82),
        B('Content Creation', 'Recorded and cut the first demo take',
          'Recorded a full walkthrough take, then cut the dead air and re-recorded the intro twice to get the pacing right.',
          '11:50 AM - 12:25 PM: recorded the walkthrough\n12:25 PM - 1:00 PM: cut dead air in CapCut\n1:00 PM - 1:18 PM: re-recorded the intro',
          'capcut.com', 'obsproject.com', 90),
        IDLE(45),
        B('Distraction', 'Scrolling X and YouTube',
          'Took a scrolling break between editing and the writeup.',
          '2:05 PM - 2:30 PM: X timeline\n2:30 PM - 2:42 PM: YouTube',
          'x.com', 'youtube.com', 38),
        B('Content Creation', 'Wrote the project writeup and README',
          'Wrote the Devpost writeup and rewrote the README opening so the problem statement lands in the first two lines.',
          '2:50 PM - 3:25 PM: drafted the Devpost writeup\n3:25 PM - 3:55 PM: rewrote the README intro',
          'devpost.com', 'github.com', 70),
        B('Assignments', 'Chipped away at the stats assignment',
          'Got through the first half of the stats assignment, mostly the confidence interval questions.',
          '4:10 PM - 4:45 PM: confidence interval questions\n4:45 PM - 5:12 PM: checked answers against the notes',
          'overleaf.com', 'wolframalpha.com', 66),
        B('Communication', 'Final check-in before the feature freeze',
          'Posted the status update, confirmed the demo video was uploaded, and closed out the open questions in the channel.',
          '7:15 PM - 7:35 PM: posted status and closed questions',
          'discord.com', None, 34),
    ]),
    # ---- light weekend day ----
    'weekend': ((11, 20), [
        B('Personal', 'Slow morning, messages and planning the week',
          'Caught up on messages and roughed out what the week looks like before touching anything else.',
          '11:20 AM - 11:40 AM: replied to messages\n11:40 AM - 12:00 PM: planned the week in Notion',
          'web.whatsapp.com', 'notion.so', 45),
        B('Distraction', 'YouTube and Instagram',
          'Long scroll through YouTube and Instagram over lunch.',
          '12:10 PM - 12:45 PM: YouTube\n12:45 PM - 1:05 PM: Instagram',
          'youtube.com', 'instagram.com', 58),
        B('Personal Projects', 'Poked at the watermark remover side project',
          'Came back to the watermark remover and got batch mode working on a folder of test images.',
          '1:30 PM - 2:10 PM: added batch mode\n2:10 PM - 2:40 PM: tested on the sample folder',
          'code.visualstudio.com', 'github.com', 74),
        IDLE(70),
        B('Content Creation', 'Edited clips for the weekly upload',
          'Trimmed the week of clips down to something postable and added captions to the first half.',
          '4:05 PM - 4:40 PM: trimmed clips\n4:40 PM - 5:05 PM: added captions',
          'capcut.com', 'instagram.com', 62),
        B('Distraction', 'Evening scrolling',
          'Ended the day scrolling Reddit and YouTube.',
          '6:30 PM - 6:55 PM: Reddit\n6:55 PM - 7:15 PM: YouTube',
          'reddit.com', 'youtube.com', 46),
    ]),
}

SCHEDULE = [
    (date(2026, 8, 10), 'study'),
    (date(2026, 8, 11), 'build'),
    (date(2026, 8, 12), 'collab'),
    (date(2026, 8, 15), 'weekend'),
    (date(2026, 8, 18), 'build'),
    (date(2026, 8, 19), 'rich'),
]

OBS = {
    'Personal Projects': ['Editing source files in VS Code and running the app to verify a change.',
                          'Reading a stack trace and stepping through the failing code path.',
                          'Reviewing a diff on GitHub and writing a commit message.'],
    'Studying': ['Reading lecture notes and annotating key sections.',
                 'Watching a recorded lecture and pausing to take notes.',
                 'Working a practice problem by hand and checking the result.'],
    'Assignments': ['Writing up a solution in Overleaf with the notes open alongside.',
                    'Checking a computed answer against the reference solution.',
                    'Formatting the writeup and exporting a PDF for submission.'],
    'Communication': ['Reading and replying to messages in Discord.',
                      'Composing an email and checking earlier threads for context.'],
    'Content Creation': ['Editing a video timeline and trimming clips.',
                         'Drafting a script outline in a document.'],
    'Personal': ['Managing calendar events and personal errands in the browser.',
                 'Replying to personal messages.'],
    'Distraction': ['Scrolling a social feed with no particular goal.',
                    'Watching short videos in sequence.'],
    'Idle': ['No input activity detected; screen unchanged.'],
}


def clear(db):
    cards = db.execute("DELETE FROM timeline_cards WHERE metadata LIKE '%\"seed\": true%'").rowcount
    db.execute("DELETE FROM observations WHERE llm_model = 'seed'")
    ids = [r[0] for r in db.execute(
        "SELECT id FROM analysis_batches WHERE llm_metadata = '\"seed\"'").fetchall()]
    if ids:
        q = ','.join('?' * len(ids))
        db.execute("DELETE FROM batch_screenshots WHERE batch_id IN (%s)" % q, ids)
        db.execute("DELETE FROM analysis_batches WHERE id IN (%s)" % q, ids)
    db.execute("DELETE FROM screenshots WHERE file_size = -1")
    db.execute("DELETE FROM daily_standup_entries")
    db.execute("DELETE FROM day_goals")
    db.execute("DELETE FROM day_goal_categories")
    db.execute("DELETE FROM timeline_review_ratings")
    db.commit()
    return cards


def main():
    if not os.path.exists(DB):
        sys.exit('database not found: ' + DB)
    db = sqlite3.connect(DB, timeout=30)
    db.execute('PRAGMA journal_mode=WAL')

    removed = clear(db)
    if '--clear' in sys.argv:
        print('cleared %d seeded cards plus their batches, observations and screenshots' % removed)
        db.close()
        return

    pool = [r[0] for r in db.execute(
        'SELECT file_path FROM screenshots WHERE is_deleted=0 AND file_size > 0 '
        'ORDER BY captured_at LIMIT 400').fetchall()]

    cards = batches = obs_n = shots = 0
    for day, tmpl in SCHEDULE:
        (sh, sm), blocks = DAY_TEMPLATES[tmpl]
        cursor = datetime(day.year, day.month, day.day, sh, sm)
        for blk in blocks:
            start = cursor
            end = start + timedelta(minutes=blk['mins'])
            cursor = end + timedelta(minutes=rng.choice([4, 6, 8, 11, 14]))

            # 15-minute analysis batches covering the block, mirroring the real pipeline
            b_id = None
            t = start
            while t < end:
                b_end = min(t + timedelta(minutes=15), end)
                b_id = db.execute(
                    'INSERT INTO analysis_batches(batch_start_ts, batch_end_ts, status, llm_metadata) '
                    'VALUES (?,?,\'completed\',\'"seed"\')', (ts(t), ts(b_end))).lastrowid
                batches += 1
                if pool:
                    k = t
                    while k < b_end:
                        idle = rng.randint(150, 900) if blk['cat'] == 'Idle' else rng.randint(0, 25)
                        sid = db.execute(
                            'INSERT INTO screenshots(captured_at, file_path, file_size, '
                            'idle_seconds_at_capture, is_deleted) VALUES (?,?,?,?,0)',
                            (ts(k), pool[shots % len(pool)], -1, idle)).lastrowid
                        db.execute('INSERT INTO batch_screenshots(batch_id, screenshot_id) VALUES (?,?)',
                                   (b_id, sid))
                        shots += 1
                        k += timedelta(seconds=30)
                t = b_end

            meta = {'seed': True}
            if blk['prim']:
                meta['appSites'] = {'primary': blk['prim']}
                if blk['sec']:
                    meta['appSites']['secondary'] = blk['sec']
            if blk['distractions']:
                ds = []
                for d in blk['distractions']:
                    d_s = start + timedelta(minutes=int(blk['mins'] * 0.45))
                    d_e = d_s + timedelta(minutes=rng.choice([3, 4]))
                    ds.append({'id': str(uuid.uuid4()).upper(), 'startTime': hmma(d_s),
                               'endTime': hmma(d_e), 'title': d['title'], 'summary': d['summary']})
                meta['distractions'] = ds

            db.execute(
                'INSERT INTO timeline_cards(batch_id,start,end,start_ts,end_ts,day,title,summary,'
                'category,subcategory,detailed_summary,metadata,is_deleted) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)',
                (b_id, hmma(start), hmma(end), ts(start), ts(end), logical_day(start),
                 blk['title'], blk['summary'], blk['cat'], '', blk['detail'],
                 json.dumps(meta)))
            cards += 1

            span = (end - start) / 4
            for i in range(rng.randint(2, 4)):
                o_s = start + span * i
                o_e = min(o_s + span, end)
                db.execute('INSERT INTO observations(batch_id,start_ts,end_ts,observation,llm_model) '
                           'VALUES (?,?,?,?,?)',
                           (b_id, ts(o_s), ts(o_e), rng.choice(OBS[blk['cat']]), 'seed'))
                obs_n += 1

    # review ratings over ~70% of the three most recent seeded days
    rated = 0
    for d in ('2026-08-19', '2026-08-18', '2026-08-15'):
        for s, e, cat in db.execute(
                'SELECT start_ts,end_ts,category FROM timeline_cards WHERE day=? AND is_deleted=0 '
                "AND category!='System' ORDER BY start_ts", (d,)).fetchall():
            if rng.random() > 0.72:
                continue
            rating = ('distracted' if cat == 'Distraction'
                      else 'neutral' if cat in ('Idle', 'Personal', 'Communication')
                      else 'focused')
            db.execute('INSERT INTO timeline_review_ratings(start_ts,end_ts,rating) VALUES (?,?,?)',
                       (s, e, rating))
            rated += 1

    # day goals for the recent days
    settings_path = os.path.join(os.environ['APPDATA'], 'dayflow-win', 'settings.json')
    cats = json.loads(open(settings_path, encoding='utf-8-sig').read()).get('colorCategories', [])
    focus = [c for c in cats if c['name'] in
             ('Studying', 'Assignments', 'Personal Projects', 'Content Creation')]
    distract = [c for c in cats if c['name'] == 'Distraction']
    now_i = int(datetime.now().timestamp())
    for d in ('2026-08-18', '2026-08-19', logical_day(datetime.now())):
        db.execute('INSERT OR REPLACE INTO day_goals(day,focus_target_minutes,'
                   'distraction_limit_minutes,is_skipped,created_at,updated_at) VALUES (?,?,?,0,?,?)',
                   (d, 270, 90, now_i, now_i))
        db.execute('DELETE FROM day_goal_categories WHERE day=?', (d,))
        for i, c in enumerate(focus):
            db.execute('INSERT INTO day_goal_categories(day,kind,category_id,category_name,'
                       'category_color_hex,sort_order) VALUES (?,\'focus\',?,?,?,?)',
                       (d, c['id'], c['name'], c['colorHex'], i))
        for i, c in enumerate(distract):
            db.execute('INSERT INTO day_goal_categories(day,kind,category_id,category_name,'
                       'category_color_hex,sort_order) VALUES (?,\'distraction\',?,?,?,?)',
                       (d, c['id'], c['name'], c['colorHex'], i))

    # standups for the recent days (the view shows the standup for the day you are on)
    STANDUPS = {
        logical_day(datetime.now()): (
            '2026-08-19',
            ['Fixed the timeline card overlap bug so short cards stay visible.',
             'Submitted the CS 135 problem set with 20 minutes to spare.',
             'Wired the Claude CLI provider in and generated cards from a live batch.',
             'Traced the black slideshow frames to a drive-letter URL bug and fixed it.'],
            ['Record the Dayflow Windows demo from the script drafted yesterday.'],
            'Waiting on the team to confirm the API contract before finishing the scheduling endpoint.'),
        '2026-08-19': (
            '2026-08-18',
            ['Shipped the TidalTasks scheduling endpoint with the calendar conflict check.',
             'Got the generated schedule rendering in the day view and fixed two timezone bugs.',
             'Opened the scheduling PR for review.',
             'Set up the first three eigenvalue questions on the linear algebra assignment.'],
            ['Finish the remaining eigenvalue questions and start the writeup.'],
            'Scheduling PR still needs a reviewer before it can merge.'),
        '2026-08-18': (
            '2026-08-15',
            ['Added batch mode to the watermark remover and tested it on the sample folder.',
             'Cut the week of clips down to a postable edit with captions on the first half.'],
            ['Start the hackathon submission demo flow.'],
            ''),
    }
    for day, (source, highs, tasks, blockers) in STANDUPS.items():
        draft = {
            'highlightsTitle': "Yesterday's highlights",
            'highlights': [{'id': str(uuid.uuid4()), 'text': t} for t in highs],
            'tasksTitle': "Today's tasks",
            'tasks': [{'id': str(uuid.uuid4()), 'text': t} for t in tasks],
            'blockersTitle': 'Blockers',
            'blockersBody': blockers,
            'generation': {'provider': 'claude', 'runtime': 'chat_cli', 'modelOrTool': 'claude',
                           'sourceDay': source, 'generatedAt': datetime.now().isoformat()},
        }
        db.execute('INSERT OR REPLACE INTO daily_standup_entries(standup_day,payload_json,updated_at) '
                   'VALUES (?,?,CURRENT_TIMESTAMP)', (day, json.dumps(draft)))

    db.commit()

    total = db.execute("SELECT COUNT(*) FROM analysis_batches "
                       "WHERE status IN ('completed','analyzed')").fetchone()[0]
    print('seeded: %d cards, %d batches, %d observations, %d screenshot rows, %d ratings'
          % (cards, batches, obs_n, shots, rated))
    print('day goals: 3 days, standups: %s' % ', '.join(sorted(STANDUPS)))
    print('TOTAL completed batches: %d (%.1fh) -- Daily needs 20, Chat 40, Weekly 120'
          % (total, total * 15 / 60.0))
    print('per-day card time:')
    for d, c, mn in db.execute(
            'SELECT day, COUNT(*), SUM(end_ts-start_ts)/60 FROM timeline_cards '
            "WHERE is_deleted=0 AND category!='System' GROUP BY day ORDER BY day").fetchall():
        print('  %s: %2d cards, %.1fh' % (d, c, mn / 60.0))
    db.close()


main()
