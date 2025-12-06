#!/bin/bash

# Commit Helper Script for MAGO TAG Monitor
# This script helps stage, commit, and optionally push changes to GitHub
# 
# Non-interactive mode: Set AUTO_COMMIT=1 to bypass all prompts
#                       Set AUTO_PUSH=1 to automatically push after commit
#                       Set COMMIT_MSG="message" to use a specific commit message

set -e

# Check for non-interactive mode
AUTO_MODE=${AUTO_COMMIT:-0}
AUTO_PUSH_MODE=${AUTO_PUSH:-0}

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "📝 Git Commit Helper for MAGO TAG Monitor"
echo "=========================================="
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
    echo "  ./scripts/setup-git.sh"
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

# Ask if user wants to stage all changes (skip in auto mode)
if [ "$AUTO_MODE" = "1" ]; then
    echo "Auto mode: Staging all changes..."
    git add .
    echo -e "${GREEN}✅ All changes staged${NC}"
    echo ""
else
    read -p "Stage all changes? (Y/n): " STAGE_ALL
    if [[ "$STAGE_ALL" =~ ^[Nn]$ ]]; then
        echo "Skipping staging. You can manually stage files with: git add <file>"
        echo ""
        read -p "Press Enter to continue or Ctrl+C to cancel..."
        STAGED=$(git diff --cached --name-only)
        if [ -z "$STAGED" ]; then
            echo -e "${RED}❌ No files staged for commit${NC}"
            exit 1
        fi
    else
        echo "Staging all changes..."
        git add .
        echo -e "${GREEN}✅ All changes staged${NC}"
        echo ""
    fi
fi

# Show what will be committed
echo -e "${BLUE}Files staged for commit:${NC}"
git diff --cached --name-status
echo ""

# Get commit message
if [ -n "$COMMIT_MSG" ]; then
    # Use commit message from environment variable
    echo "Using commit message from COMMIT_MSG: $COMMIT_MSG"
elif [ -n "$1" ]; then
    COMMIT_MSG="$1"
    echo "Using provided commit message: $COMMIT_MSG"
elif [ "$AUTO_MODE" = "1" ]; then
    # Auto mode: generate default commit message
    CHANGED_FILES=$(git diff --cached --name-only | head -3 | tr '\n' ',' | sed 's/,$//')
    COMMIT_MSG="Update: $CHANGED_FILES"
    echo "Auto mode: Using default commit message: $COMMIT_MSG"
else
    echo "Enter commit message (or press Enter for default):"
    read -p "> " COMMIT_MSG
    
    if [ -z "$COMMIT_MSG" ]; then
        # Generate default commit message based on changes
        CHANGED_FILES=$(git diff --cached --name-only | head -3 | tr '\n' ',' | sed 's/,$//')
        COMMIT_MSG="Update: $CHANGED_FILES"
        echo "Using default commit message: $COMMIT_MSG"
    fi
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
        
        # Auto push mode or ask user
        if [ "$AUTO_PUSH_MODE" = "1" ] || [ "$AUTO_MODE" = "1" ]; then
            echo "Auto mode: Pushing to GitHub..."
            CURRENT_BRANCH=$(git branch --show-current)
            if git push -u origin "$CURRENT_BRANCH" 2>&1; then
                echo -e "${GREEN}✅ Successfully pushed to GitHub!${NC}"
            else
                echo -e "${YELLOW}⚠️  Push failed. You may need to:${NC}"
                echo "  1. Check your GitHub credentials"
                echo "  2. Verify you have push access to the repository"
                echo "  3. Try pushing manually: git push"
                exit 1
            fi
        else
            read -p "Push to GitHub? (Y/n): " PUSH_CHOICE
            if [[ ! "$PUSH_CHOICE" =~ ^[Nn]$ ]]; then
                echo ""
                echo "Pushing to GitHub..."
                CURRENT_BRANCH=$(git branch --show-current)
                if git push -u origin "$CURRENT_BRANCH" 2>&1; then
                    echo -e "${GREEN}✅ Successfully pushed to GitHub!${NC}"
                else
                    echo -e "${YELLOW}⚠️  Push failed. You may need to:${NC}"
                    echo "  1. Check your GitHub credentials"
                    echo "  2. Verify you have push access to the repository"
                    echo "  3. Try pushing manually: git push"
                fi
            else
                echo "Skipping push. You can push later with: git push"
            fi
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
