# Quest 1 Your first terminal and files

Review draft v1 — beginner module, not yet published in the platform

## What you will learn

You do not need previous coding experience. By the end, you should be able to locate your work, create and inspect a text file, run a small Bash script, search a practice folder, explain a short pipeline, and record a local Git change. You will practise explaining problems to a peer rather than copying a solution.

The checks below are practice checks, not an implemented automatic grader or a scoring policy. Your facilitator will confirm which tasks are enabled and which file types the upload screen accepts. Do not assume that every task in this draft can already be submitted.

## Before you begin

Ask your facilitator to confirm a working Bash terminal, a text editor and the required tools for your operating system. PowerShell and Bash are not interchangeable. Do not install tools or change system settings just to match an unfamiliar error. No Go installation is needed for these shell activities.

Create a new, empty folder named `q1-practice` using your file manager in a location you own. If that name already exists, use a new name; never replace existing work. Open a terminal there with help if needed. Type `pwd` and confirm the printed path ends in your new folder. This is your practice area, not your home folder, a work repository or a shared folder.

Safety rules: use only your disposable practice files. Before changing anything, check where you are. Do not use administrator privileges, deletion commands, recursive permission changes or commands that download and execute code. Do not upload passwords, tokens, keys, personal files or the hidden `.git` folder. A redirection with `>` can overwrite a file: use your editor for early tasks and ask before trying it.

## 1 Know where you are

**Goal:** distinguish a command from its output, and a file from a folder.

Create an empty `notes` folder and a `welcome.txt` file in your practice area using your editor or file manager. Put one sentence in the file. Use `pwd` and `ls` to inspect the practice area. Enter `notes`, inspect your location, and return to its parent using `cd ..`. Never keep repeating `cd ..` without checking the resulting path.

**Check:** show where the file is in both the file manager and terminal. Explain why entering a folder did not move your file. Read your file with `cat welcome.txt` from the practice root. If it is not found, inspect your location and spelling before recreating it.

**Hint:** a relative path starts from where you are now; an absolute path identifies a location from the filesystem root. For a filename containing spaces, investigate quoting before using it in a command.

**Evidence:** keep a short `learning-notes.txt` with the command, expected result and actual result. Do not include private absolute paths in submitted evidence.

## 2 Create a precise text file

Adapted from `cl-camp2`.

**Task:** in a new `text-task` subfolder, create a file named `r` containing one uppercase `R` followed by a single newline. No extra spaces or extra blank lines. It is a text file, not a script.

**Check:** read it with `cat r`. Ask your facilitator for a line-ending inspection command supported by your system. On the source's GNU-style environment, `cat -e r` should show `R$`; the `$` is an inspection marker, not a character to put in the file.

**Hint:** your editor's final newline is different from an additional empty line.

**Proposed upload artifact:** `r`, if that file type is enabled. Explain what `cat` does; it does not run the contents as instructions.

## 3 Run your first script

Adapted from the source introduction.

**Task:** create `hello.sh` in a separate `hello-task` folder. It should display `Hello learner!` on one line when run with `bash hello.sh`. This draft uses the fixed label `learner` to avoid requiring an account or personal username. A future personalized version needs its own agreed expected output.

**Check:** save, run, and compare the exact text. Edit your greeting temporarily, save and rerun to see which version executes; restore the required greeting. Run from a different practice subfolder using a relative path to your script.

**Hint:** use Bash's `help` for a text-output command such as `printf`. The file contains instructions; Bash interprets them. You do not need to make it executable when explicitly running it with `bash`.

**Proposed upload artifact:** `hello.sh`, not a screenshot of its output.

## 4 Search first then count

Adapted from `cl-camp6`.

**Setup:** create a separate `inventory-task` folder. Inside it create `notes` and `scripts` folders, `notes/a.txt`, and `scripts/b.txt`. These are disposable text files. Before adding your solution file, the tree has five entries when the inventory root itself is counted.

**Task:** build `countfiles.sh` that prints only the number of regular files and folders in its current directory and below, including the current directory itself. Hidden regular files and folders count; do not follow symbolic links. These explicit boundary choices are proposed for this draft. Keep the script outside the fixture so it does not accidentally change the expected count.

**Check:** run from the inventory folder by referring to the script's relative path. Expect 5 for the tree above. Add one text file with your editor and expect 6. Inspect the raw search results before trusting a count. Keep a checklist of exactly what is included.

**Hints:** first learn to list matching paths with `find`; then learn how `wc` counts lines. A pipe sends one command's output into another command. Start with each command separately. Use simple filenames without newlines in these first fixtures.

## 5 Read a listing one rule at a time

Adapted from `cl-camp1`.

**Task:** prepare a command in `mastertheLS` that lists the current folder's visible entries, separates names using commas only, orders by newest access time first, and marks directories with a trailing slash. Do not include hidden entries, `.` or `..`.

**Check:** inspect one requirement at a time, then combine them. Add a visible file, a hidden file and a folder in a fresh fixture. Predict which names appear. Ordering by access time needs a facilitator-prepared fixture with known, distinct access times; do not guess those times or confuse access time with modification time. Platform-specific formatting must be agreed before strict grading.

**Hint:** look up the options in your installed `ls` help/manual; flags control different aspects of the listing. `mastertheLS` stores command text, so reading it with `cat` does not execute it.

## 6 Find names and transform output

Adapted from `cl-camp5`, then `cl-camp3`, then `cl-camp8`. Complete them separately.

**A — lookagain.sh:** find regular files ending in `.sh` in a fixture and its subfolders. Print each basename without its final `.sh`, one per line, in descending order. For the first practice fixture use unique lowercase basenames without spaces; later checks should address spaces and duplicate basenames explicitly. A file called `report.old.sh` should keep `report.old`, not lose everything after its first dot.

**Check:** create `alpha.sh`, `beta.sh`, and `ignore.txt`. Predict the two output lines before running. Add a matching file in a nested folder. Compare the raw search list with the transformed list.

**B — look:** store a command that finds paths whose names start with `a`, end with `z`, or start with `z` and end with `a!`. Work only within a small practice fixture.

**Check:** test one match for each rule and at least one non-match. A name only has to match one rule, not all three. Ordering is not a proposed requirement here; compare matching paths as a set.

**C — skip.sh:** from `ls -l` output, skip the first line, keep the second, skip the third, and continue alternating. This refers to output lines, including the initial summary line if your `ls` emits one.

**Check:** number a short sample on paper first and mark the lines you intend to keep. Compare with actual output. Do not assume line numbers equal file numbers.

**Hints:** use the documentation for `find` name patterns and OR; for line selection investigate `sed` or `awk`. Explain each stage of a pipeline before combining it. No final solution commands are provided.

## 7 Explore permissions safely

New bridge towards `make-it-better`; the original full exercise remains a later extension.

**Task:** in a fresh `permissions-task` folder, create two disposable text files. Inspect their modes with `ls -l`. Explain read, write and execute for the owner. With your facilitator, make just one file read-only for its owner, inspect the change, then restore owner write permission. Do not change folder permissions, other users' files or a whole tree.

**Check:** identify the target file before every change, and explain why an executable bit is not the same as readable content. Use an explicit single filename; never a wildcard for this practice.

**Hint:** consult `chmod` symbolic-mode help. Do not solve an error by applying broad permissions. An editor may replace a file rather than edit it in place, so the mode inspection—not an editor's behavior alone—is the evidence here.

**Later extension:** the original `make-it-better` requires matching timestamps, permissions, a symlink and a tar archive. Attempt it only after those topics and the operating-system differences have been introduced. Do not upload an entire practice directory containing unrelated work.

## 8 Track local changes with Git

Adapted from the introduction, with remote submission deliberately separated.

**Setup:** facilitator confirms Git is installed. Create a new `git-task` folder inside your practice area and verify it is not inside an existing repository before initializing it. If commits require author identity, ask for the agreed local-only configuration; do not change global settings or enter credentials.

**Task:** initialize a local repository there, create a practice text file, inspect status, stage that named file and commit it. Change one sentence, inspect the difference, then stage and make a second commit with a descriptive message. Inspect the short history.

**Check:** explain working file versus staged change versus commit. Show two commits. Explain what would happen if you edited the file again after staging it. Do not commit secrets or your full home directory.

**Hint:** investigate `git init`, `git status`, `git diff`, `git add`, `git commit` and `git log --oneline`. Use explicit filenames while learning. No remote, push, account creation or credential storage is needed for this task.

**Submission reality:** the platform uses file uploads in the supplied context. A Git commit does not upload a solution there. Follow the enabled task's upload instructions; do not upload `.git`. Proposed evidence for review is a short sanitized text explanation and the practice file, only if the relevant upload task accepts them.

## Review with a peer

Proposed manual checkpoint, not an implemented exam:
- Find a named practice file starting from another practice subfolder.
- Explain the difference between reading `hello.sh` and running it.
- Add a fixture file and predict how a search/count changes.
- Diagnose a deliberate wrong-path error without recreating or deleting files.
- Explain a local Git change and why it is separate from platform upload.

Your peer asks questions rather than typing the answer for you. Change one input and repeat your explanation. Record what you first tried, what the result showed, and what you changed. If you remain stuck, share the exact command, expected output, actual output and your location relative to the practice folder—not private account details.

## Later not removed

The curl/jq/JSON exercises return in a later bridge: `to-git-or-not-to-git`, `who-are-you`, then `cl-camp4`. They need a verified data source and introduction to JSON and environment variables. The source's placeholder URLs are not usable task inputs. `cl-camp7` is an optional quoting stretch. `now-get-to-work` depends on an external repository and is not enabled by this draft.

## Small optional resources

Read only the relevant sections. These are references, not instructions to execute every example.
- [Ubuntu command-line beginner tutorial](https://documentation.ubuntu.com/desktop/en/latest/tutorial/the-linux-command-line-for-beginners/): opening a terminal, location, files and folders. Skip deletion and superuser sections for this module.
- [What is Git](https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F): mental model before task 8.
- [Recording changes](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository): status, diff, staging and commit only.
- [Official Git video index](https://git-scm.com/videos): optional “What is Version Control?” listed as 5:59. Index verified on 28 October 2026; playback/captions not checked.

For individual commands use the help/manual installed on your machine; option support can differ between operating systems. Ask for one hint when needed, not a complete solution.
