#!/bin/bash

# Git Setup Script for MAGO TAG Monitor
# This script checks and configures git user.name and user.email
#
# Non-interactive mode: Set AUTO_SETUP=1 to skip prompts
#                       Set GIT_USER_NAME="name" and GIT_USER_EMAIL="email" to configure automatically

set -e

# Check for non-interactive mode
AUTO_MODE=${AUTO_SETUP:-0}

echo "🔧 Git Setup for MAGO TAG Monitor"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Error: git is not installed${NC}"
    echo "Please install git first: https://git-scm.com/downloads"
    exit 1
fi

# Check current git user configuration
echo "Checking git configuration..."
echo ""

USER_NAME=$(git config user.name 2>/dev/null || echo "")
USER_EMAIL=$(git config user.email 2>/dev/null || echo "")

# Check if configured locally or globally
GLOBAL_USER_NAME=$(git config --global user.name 2>/dev/null || echo "")
GLOBAL_USER_EMAIL=$(git config --global user.email 2>/dev/null || echo "")

if [ -n "$USER_NAME" ] && [ -n "$USER_EMAIL" ]; then
    echo -e "${GREEN}✅ Git user is configured:${NC}"
    echo "   Name:  $USER_NAME"
    echo "   Email: $USER_EMAIL"
    if [ -n "$(git config --local user.name 2>/dev/null)" ]; then
        echo "   Scope: Local (repository-specific)"
    else
        echo "   Scope: Global"
    fi
    echo ""
    echo "You're all set! You can now commit changes."
    exit 0
fi

# Not configured - need to set it up
echo -e "${YELLOW}⚠️  Git user.name and/or user.email are not configured${NC}"
echo ""

# Determine scope preference
if [ -n "$GLOBAL_USER_NAME" ] && [ -n "$GLOBAL_USER_EMAIL" ]; then
    echo "Found global git configuration:"
    echo "   Name:  $GLOBAL_USER_NAME"
    echo "   Email: $GLOBAL_USER_EMAIL"
    echo ""
    
    if [ "$AUTO_MODE" = "1" ]; then
        # Auto mode: use global config
        echo "Auto mode: Using global git configuration"
        echo -e "${GREEN}✅ Using global git configuration${NC}"
        exit 0
    else
        read -p "Use global config for this repository? (Y/n): " USE_GLOBAL
        if [[ "$USE_GLOBAL" =~ ^[Nn]$ ]]; then
            SCOPE="local"
        else
            echo -e "${GREEN}✅ Using global git configuration${NC}"
            exit 0
        fi
    fi
else
    if [ "$AUTO_MODE" = "1" ]; then
        # Auto mode: default to local scope
        SCOPE="local"
        echo "Auto mode: Using local (repository-specific) configuration"
    else
        echo "Choose configuration scope:"
        echo "1) Global (for all repositories)"
        echo "2) Local (for this repository only)"
        read -p "Enter choice (1 or 2): " SCOPE_CHOICE
        
        if [ "$SCOPE_CHOICE" = "1" ]; then
            SCOPE="global"
        else
            SCOPE="local"
        fi
    fi
fi

# Get user name
if [ -z "$USER_NAME" ]; then
    if [ "$AUTO_MODE" = "1" ]; then
        # Auto mode: use environment variable or fail
        if [ -n "$GIT_USER_NAME" ]; then
            NAME_TO_SET="$GIT_USER_NAME"
            echo "Auto mode: Using GIT_USER_NAME from environment"
        else
            echo -e "${RED}❌ Error: AUTO_SETUP=1 but GIT_USER_NAME is not set${NC}"
            echo "   Please set GIT_USER_NAME environment variable or run interactively"
            exit 1
        fi
    else
        if [ -n "$GLOBAL_USER_NAME" ]; then
            DEFAULT_NAME="$GLOBAL_USER_NAME"
        else
            DEFAULT_NAME=""
        fi
        
        read -p "Enter your git user.name${DEFAULT_NAME:+ (default: $DEFAULT_NAME)}: " INPUT_NAME
        NAME_TO_SET="${INPUT_NAME:-$DEFAULT_NAME}"
    fi
    
    if [ -z "$NAME_TO_SET" ]; then
        echo -e "${RED}❌ Error: user.name cannot be empty${NC}"
        exit 1
    fi
    
    git config --$SCOPE user.name "$NAME_TO_SET"
    echo -e "${GREEN}✅ Set user.name to: $NAME_TO_SET${NC}"
fi

# Get user email
if [ -z "$USER_EMAIL" ]; then
    if [ "$AUTO_MODE" = "1" ]; then
        # Auto mode: use environment variable or fail
        if [ -n "$GIT_USER_EMAIL" ]; then
            EMAIL_TO_SET="$GIT_USER_EMAIL"
            echo "Auto mode: Using GIT_USER_EMAIL from environment"
        else
            echo -e "${RED}❌ Error: AUTO_SETUP=1 but GIT_USER_EMAIL is not set${NC}"
            echo "   Please set GIT_USER_EMAIL environment variable or run interactively"
            exit 1
        fi
    else
        if [ -n "$GLOBAL_USER_EMAIL" ]; then
            DEFAULT_EMAIL="$GLOBAL_USER_EMAIL"
        else
            DEFAULT_EMAIL=""
        fi
        
        read -p "Enter your git user.email${DEFAULT_EMAIL:+ (default: $DEFAULT_EMAIL)}: " INPUT_EMAIL
        EMAIL_TO_SET="${INPUT_EMAIL:-$DEFAULT_EMAIL}"
    fi
    
    if [ -z "$EMAIL_TO_SET" ]; then
        echo -e "${RED}❌ Error: user.email cannot be empty${NC}"
        exit 1
    fi
    
    git config --$SCOPE user.email "$EMAIL_TO_SET"
    echo -e "${GREEN}✅ Set user.email to: $EMAIL_TO_SET${NC}"
fi

# Verify remote configuration
echo ""
echo "Checking remote configuration..."
REMOTE_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")
if [ -n "$REMOTE_URL" ]; then
    echo -e "${GREEN}✅ Remote 'origin' is configured: $REMOTE_URL${NC}"
else
    echo -e "${YELLOW}⚠️  No remote 'origin' configured${NC}"
    echo "   To add a remote, run:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
fi

echo ""
echo -e "${GREEN}✅ Git setup complete!${NC}"
echo ""
echo "You can now commit changes using:"
echo "  git add ."
echo "  git commit -m 'Your commit message'"
echo ""
echo "Or use the commit helper script:"
echo "  ./scripts/commit.sh"
