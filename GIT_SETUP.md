# Git Setup Guide for MAGO TAG Monitor

This guide helps you configure git and commit changes to GitHub for the MAGO TAG Monitor application.

## Quick Start

1. **Run the setup script** to configure git:
   ```bash
   ./scripts/setup-git.sh
   ```

2. **Commit your changes** using the helper script:
   ```bash
   ./scripts/commit.sh
   ```

That's it! Read on for more details.

## Initial Git Configuration

### Problem: "Please tell me who you are" Error

If you see this error when trying to commit:
```
*** Please tell me who you are.
Run
  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"
```

This means git doesn't know who you are. You need to configure your name and email.

### Solution: Use the Setup Script

The easiest way is to use the provided setup script:

```bash
./scripts/setup-git.sh
```

This script will:
- Check if git user is already configured
- Prompt you to set your name and email if missing
- Let you choose between global (all repos) or local (this repo only) configuration
- Verify your remote repository is configured

### Manual Configuration

If you prefer to configure manually:

**For all repositories (global):**
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

**For this repository only (local):**
```bash
git config --local user.name "Your Name"
git config --local user.email "your.email@example.com"
```

### Verify Configuration

Check your current git configuration:
```bash
git config user.name
git config user.email
```

## Committing Changes

### Using the Commit Helper Script (Recommended)

The commit helper script makes it easy to commit and push changes:

```bash
./scripts/commit.sh
```

Or with a commit message:
```bash
./scripts/commit.sh "Your commit message here"
```

The script will:
1. Check that git is properly configured
2. Show you what files have changed
3. Stage all changes (or let you choose)
4. Prompt for a commit message
5. Commit the changes
6. Optionally push to GitHub

### Manual Git Commands

If you prefer using git directly:

**1. Check what changed:**
```bash
git status
```

**2. Stage files:**
```bash
# Stage all changes
git add .

# Or stage specific files
git add src/index.js package.json
```

**3. Commit:**
```bash
git commit -m "Your descriptive commit message"
```

**4. Push to GitHub:**
```bash
git push
```

If it's your first push to a branch:
```bash
git push -u origin main
```

## Non-Interactive Mode (For Agents and Automation)

The scripts support non-interactive mode for use by agents, CI/CD systems, and automation tools.

### Auto Commit Script (Recommended for Agents)

For agents and automation, use the dedicated auto commit script:

```bash
COMMIT_MSG="Your commit message" ./scripts/commit-auto.sh
```

This script:
- Runs completely non-interactively (no prompts)
- Automatically stages all changes
- Uses the commit message from `COMMIT_MSG` environment variable (or generates one)
- Automatically pushes to GitHub (unless `AUTO_PUSH=0` is set)

**Example:**
```bash
COMMIT_MSG="Fix: Update monitoring thresholds" ./scripts/commit-auto.sh
```

**Skip pushing:**
```bash
COMMIT_MSG="Update config" AUTO_PUSH=0 ./scripts/commit-auto.sh
```

### Using commit.sh in Non-Interactive Mode

The regular `commit.sh` script also supports non-interactive mode via environment variables:

```bash
AUTO_COMMIT=1 AUTO_PUSH=1 COMMIT_MSG="Your message" ./scripts/commit.sh
```

**Environment Variables:**
- `AUTO_COMMIT=1` - Bypass all prompts, automatically stage and commit
- `AUTO_PUSH=1` - Automatically push after commit (can be used independently)
- `COMMIT_MSG="message"` - Use this commit message instead of prompting

**Examples:**
```bash
# Auto commit and push with custom message
AUTO_COMMIT=1 AUTO_PUSH=1 COMMIT_MSG="Update dependencies" ./scripts/commit.sh

# Auto commit but don't push
AUTO_COMMIT=1 COMMIT_MSG="Local changes" ./scripts/commit.sh

# Just auto-push (after manual commit)
AUTO_PUSH=1 ./scripts/commit.sh
```

### Using setup-git.sh in Non-Interactive Mode

The setup script can also run non-interactively:

```bash
AUTO_SETUP=1 GIT_USER_NAME="Agent Name" GIT_USER_EMAIL="agent@example.com" ./scripts/setup-git.sh
```

**Environment Variables:**
- `AUTO_SETUP=1` - Skip all prompts
- `GIT_USER_NAME="name"` - Git user name (required if AUTO_SETUP=1 and git not configured)
- `GIT_USER_EMAIL="email"` - Git user email (required if AUTO_SETUP=1 and git not configured)

**Note:** If git is already configured, the script will exit successfully without prompting, even in interactive mode.

### Agent Workflow Example

Here's a complete workflow for an agent making changes:

```bash
# 1. Setup git (if not already configured)
GIT_USER_NAME="CI Agent" GIT_USER_EMAIL="ci@example.com" AUTO_SETUP=1 ./scripts/setup-git.sh

# 2. Make your changes (edit files, etc.)

# 3. Commit and push automatically
COMMIT_MSG="Automated update: $(date)" ./scripts/commit-auto.sh
```

Or using the regular commit script:
```bash
AUTO_COMMIT=1 AUTO_PUSH=1 COMMIT_MSG="Automated update" ./scripts/commit.sh
```

## Common Issues and Solutions

### Issue: "Changes not staged for commit"

**Problem:** You modified files but didn't stage them.

**Solution:** Stage the files first:
```bash
git add .
# or
git add <specific-file>
```

### Issue: "Nothing to commit, working tree clean"

**Problem:** All your changes are already committed, or you haven't made any changes.

**Solution:** 
- Check if you have uncommitted changes: `git status`
- If you want to commit changes, make sure you've saved your files
- If everything is committed, you're good to go!

### Issue: "Failed to push some refs"

**Problem:** Your local branch is behind the remote branch (someone else pushed changes).

**Solution:** Pull the latest changes first:
```bash
git pull
# Resolve any conflicts if needed
git push
```

### Issue: "Permission denied" when pushing

**Problem:** You don't have push access to the repository, or authentication failed.

**Solutions:**
1. **Check your GitHub credentials:**
   - Make sure you're authenticated: `gh auth status` (if using GitHub CLI)
   - Or use SSH keys or personal access tokens

2. **Verify repository access:**
   - Make sure you have write access to the repository
   - Check that the remote URL is correct: `git remote -v`

3. **Update remote URL if needed:**
   ```bash
   git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   ```

### Issue: Pre-commit hook failed

**Problem:** The pre-commit hook found an issue (like missing git user config).

**Solution:** Follow the error message. Usually it means:
- Git user.name or user.email is not set → Run `./scripts/setup-git.sh`
- No files staged → Stage files with `git add`

## Git Workflow for This Project

Since this app runs on GitHub Actions, here's the recommended workflow:

1. **Make your changes** to the code
2. **Test locally** (if possible):
   ```bash
   npm start
   ```
3. **Commit your changes:**
   ```bash
   ./scripts/commit.sh "Description of your changes"
   ```
4. **Push to GitHub:**
   - The commit script will offer to push automatically
   - Or push manually: `git push`
5. **Verify on GitHub:**
   - Check the Actions tab to see if the workflow runs successfully
   - Review your changes in the repository

## What Gets Committed?

The `.gitignore` file controls what is **not** committed. Currently ignored:

- `node_modules/` - Dependencies (installed via npm)
- `.env` - Environment variables (sensitive)
- `config.json` - Local configuration (sensitive)
- `*.png`, `*.jpg`, `*.jpeg` - Image files
- `screenshot.png` - Generated screenshots
- `debug-json-data.json` - Debug output files
- `.DS_Store` - macOS system files

**Everything else** (source code, configs, documentation) should be committed.

## Pre-commit Hook

A pre-commit hook is installed to validate commits. It checks:
- ✅ Git user.name and user.email are configured
- ✅ At least one file is staged for commit
- ✅ Provides helpful error messages if something is wrong

The hook **does not** auto-commit anything - it only validates.

## GitHub Actions Integration

This project uses GitHub Actions for automated monitoring. When you push to GitHub:

1. The workflow runs automatically (twice daily on schedule: 9:15 AM and 6:15 PM São Paulo time)
2. You can also trigger it manually from the Actions tab
3. The workflow uses secrets configured in GitHub (not in the code)

**Important:** Never commit sensitive information like:
- API keys
- Passwords
- Personal access tokens
- Email credentials

These should be stored as GitHub Secrets (Settings → Secrets and variables → Actions).

## Getting Help

If you're still having trouble:

1. **Check git status:**
   ```bash
   git status
   ```

2. **Check git configuration:**
   ```bash
   git config --list
   ```

3. **Review this guide** for common issues

4. **Check GitHub documentation:**
   - [Git Handbook](https://guides.github.com/introduction/git-handbook/)
   - [GitHub Docs](https://docs.github.com/en/get-started)

## Summary

- **First time setup:** Run `./scripts/setup-git.sh`
- **Committing changes (interactive):** Run `./scripts/commit.sh`
- **Committing changes (automation):** Run `./scripts/commit-auto.sh` or use `AUTO_COMMIT=1` with `commit.sh`
- **Manual commands:** Use standard `git add`, `git commit`, `git push`
- **Troubleshooting:** Check the "Common Issues" section above

### Quick Reference for Agents

```bash
# Setup git (non-interactive)
AUTO_SETUP=1 GIT_USER_NAME="Name" GIT_USER_EMAIL="email@example.com" ./scripts/setup-git.sh

# Commit and push (non-interactive)
COMMIT_MSG="Your message" ./scripts/commit-auto.sh
```

Happy committing! 🚀
