#!/bin/bash

# Auto Commit Script for MAGO TAG Monitor
# This script is designed for agents and automation - it runs completely non-interactively
# 
# Usage:
#   COMMIT_MSG="Your message" ./scripts/commit-auto.sh
#   Or set AUTO_PUSH=0 to skip pushing

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🤖 Auto Commit Script for MAGO TAG Monitor"
echo "==========================================="
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Error: git is not installed${NC}"
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Not in a git repository${NC}"
    exit 1
fi

# Check if git user is configured
USER_NAME=$(git config user.name 2>/dev/null || echo "")
USER_EMAIL=$(git config user.email 2>/dev/null || echo "")

if [ -z "$USER_NAME" ] || [ -z "$USER_EMAIL" ]; then
    echo -e "${RED}❌ Error: Git user.name and/or user.email are not configured${NC}"
    echo ""
    echo "Please run the setup script first:"
    echo "  GIT_USER_NAME=\"Your Name\" GIT_USER_EMAIL=\"your@email.com\" AUTO_SETUP=1 ./scripts/setup-git.sh"
    exit 1
fi

echo -e "${GREEN}✅ Git user configured:${NC} $USER_NAME <$USER_EMAIL>"
echo ""

# Check current status
echo "Checking repository status..."
STATUS=$(git status --porcelain)

if [ -z "$STATUS" ]; then
    echo -e "${YELLOW}⚠️  No changes to commit${NC}"
    echo ""
    echo "Working directory is clean. Nothing to commit."
    exit 0
fi

# Show what will be committed
echo -e "${BLUE}Files with changes:${NC}"
git status --short
echo ""

# Stage all changes
echo "Staging all changes..."
git add .
echo -e "${GREEN}✅ All changes staged${NC}"
echo ""

# Show what will be committed
echo -e "${BLUE}Files staged for commit:${NC}"
git diff --cached --name-status
echo ""

# Get commit message
if [ -z "$COMMIT_MSG" ]; then
    # Generate default commit message based on changes
    CHANGED_FILES=$(git diff --cached --name-only | head -3 | tr '\n' ',' | sed 's/,$//')
    COMMIT_MSG="Update: $CHANGED_FILES"
    echo "Using auto-generated commit message: $COMMIT_MSG"
else
    echo "Using commit message from COMMIT_MSG: $COMMIT_MSG"
fi

# Commit
echo ""
echo "Committing changes..."
if git commit -m "$COMMIT_MSG"; then
    echo -e "${GREEN}✅ Commit successful!${NC}"
    echo ""
    
    # Show commit info
    echo -e "${BLUE}Commit details:${NC}"
    git log -1 --stat
    echo ""
    
    # Check if remote is configured
    REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")
    if [ -n "$REMOTE_URL" ]; then
        echo -e "${BLUE}Remote configured:${NC} $REMOTE_URL"
        echo ""
        
        # Check if we should push (default to yes unless AUTO_PUSH=0)
        AUTO_PUSH_MODE=${AUTO_PUSH:-1}
        if [ "$AUTO_PUSH_MODE" = "1" ]; then
            echo "Pushing to GitHub..."
            CURRENT_BRANCH=$(git branch --show-current)
            if git push -u origin "$CURRENT_BRANCH" 2>&1; then
                echo -e "${GREEN}✅ Successfully pushed to GitHub!${NC}"
            else
                echo -e "${RED}❌ Push failed${NC}"
                echo ""
                echo "You may need to:"
                echo "  1. Check your GitHub credentials"
                echo "  2. Verify you have push access to the repository"
                echo "  3. Try pushing manually: git push"
                exit 1
            fi
        else
            echo "AUTO_PUSH=0: Skipping push. You can push later with: git push"
        fi
    else
        echo -e "${YELLOW}⚠️  No remote 'origin' configured${NC}"
        echo "   To add a remote, run:"
        echo "   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
    fi
else
    echo -e "${RED}❌ Commit failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Done!${NC}"

