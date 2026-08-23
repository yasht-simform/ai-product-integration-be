# Tutorial: Linking GitHub Commits to Tasks

In this tutorial you will connect a GitHub repository to CloudPulse and link a commit directly to
a task using nothing more than the task's ID in your commit message. This takes about 5 minutes and
requires no changes to your existing git workflow.

## What the GitHub Integration Does

Once a repository is authorized, CloudPulse watches for commit messages that include a task
reference in the form `[CP-142]` — a bracketed task ID matching one of your workspace's tasks. When
it finds one, it automatically links the commit (and, if applicable, the pull request it belongs
to) to that task, so anyone looking at the task can see exactly which code changes relate to it
without hunting through GitHub separately.

## Before You Start

You'll need admin (or owner) permissions on the GitHub organization or repository you want to
connect, since installing the CloudPulse GitHub App requires GitHub's own installation approval
flow. You'll also want at least one existing task whose ID you can reference — task IDs look like
`CP-142` and are visible in the task detail panel or in the task's URL.

## Step 1: Open the Integrations Settings Page

From your CloudPulse workspace, click **Settings** in the sidebar, then select **Integrations**.
Find the GitHub card among the available integrations.

## Step 2: Authorize a Repository

Click **Connect** on the GitHub card. This opens GitHub's own app installation screen. Choose
whether to install the CloudPulse GitHub App on **all repositories** in your organization or only
**selected repositories** — for most teams starting out, selecting just the one or two repositories
you actively work in is the safer choice, since you can always add more later from the same screen.
Confirm the installation on GitHub's side, and you'll be redirected back to CloudPulse once it
completes.

## Step 3: Confirm the Connection

Back on the Integrations page, the GitHub card should now show a status of **Connected**, along
with the name of the repository (or repositories) you authorized. If you connected more than one
repository, each one is listed separately, since task linking works per-repository.

## Step 4: Find a Task ID to Reference

Open any existing task — for this tutorial, let's say it's titled "Fix login redirect bug" and its
ID, shown near the top of the task detail panel, is `CP-142`. If you don't have a suitable task
yet, create one first (see the **Create Your First CloudPulse Board** tutorial for how).

## Step 5: Reference the Task in a Commit Message

In your local clone of the connected repository, make a small change and commit it with the task ID
included in brackets somewhere in the commit message:

```bash
git commit -m "Fix redirect loop on expired session [CP-142]"
```

Push the commit to GitHub as you normally would:

```bash
git push origin main
```

You don't need to change anything else about how you commit or push — CloudPulse scans commit
messages on push through the GitHub App you installed in Step 2, and the `[CP-142]` reference is
all it needs to make the connection.

## Step 6: View the Linked Commit on the Task

Go back to CloudPulse and open task `CP-142`. In the task detail panel, you should now see a new
**Linked Commits** section listing the commit you just pushed, including its message, author, and a
link back to the commit on GitHub. If the commit was part of a pull request, the pull request
itself (including its open/merged status) appears alongside it.

## Step 7: Link Multiple Tasks in One Commit

If a single commit touches work spanning more than one task, include multiple bracketed IDs in the
same commit message — for example, `"Refactor auth middleware [CP-142] [CP-156]"` — and CloudPulse
links the commit to both tasks independently.

## Troubleshooting

If a commit doesn't show up on the task after a few minutes, double-check that the task ID in your
commit message exactly matches the task's real ID (including the `CP-` prefix and correct number),
and confirm the repository you pushed to is the same one authorized in Step 2 — a task ID pushed to
an unconnected repository won't be picked up.

## What's Next

With commits linking automatically to tasks, consider pairing this with the **Creating Your First
Automation Rule** tutorial to, for example, automatically move a task to In Review the moment its
first linked pull request opens — or explore the **Connecting Slack to CloudPulse** tutorial so
your team sees these updates without leaving chat.
