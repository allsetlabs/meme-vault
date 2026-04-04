# Meme Vault Makefile
# Usage: cd modules/meme-vault && make <target>

GREEN := \033[0;32m
BLUE := \033[0;34m
YELLOW := \033[1;33m
NC := \033[0m

APP_PORT := 3000

.PHONY: help setup install start stop

help:
	@echo "$(BLUE)Meme Vault Commands:$(NC)"
	@echo "  make install  - Install dependencies"
	@echo "  make start    - Start Next.js dev server and worker"
	@echo "  make stop     - Stop all services"

setup:
	@echo "$(BLUE)Checking system dependencies...$(NC)"
	@command -v node >/dev/null 2>&1 || { echo "Installing Node.js..."; brew install node; }
	@command -v tmux >/dev/null 2>&1 || { echo "Installing tmux..."; brew install tmux; }
	@command -v docker >/dev/null 2>&1 || { echo "Docker required for Supabase. Install Docker Desktop."; }
	@echo "$(GREEN)All system dependencies ready!$(NC)"

install:
	@echo "$(BLUE)Installing Meme Vault...$(NC)"
	npm install
	@echo "$(GREEN)Meme Vault ready!$(NC)"

start:
	@echo "$(BLUE)Starting Meme Vault services in tmux session 'meme-vault'...$(NC)"
	@if tmux has-session -t meme-vault 2>/dev/null; then \
		echo "$(YELLOW)Session 'meme-vault' already exists. Killing it first...$(NC)"; \
		tmux kill-session -t meme-vault; \
	fi
	@npx kill-port $(APP_PORT) 2>/dev/null || true
	@tmux new-session -d -s meme-vault -n app -c $(CURDIR)
	@tmux send-keys -t meme-vault:app 'npm run dev' C-m
	@sleep 2
	@tmux new-window -t meme-vault -n worker -c $(CURDIR)
	@tmux send-keys -t meme-vault:worker 'npm run dev:worker' C-m
	@echo ""
	@echo "$(GREEN)Meme Vault started!$(NC)"
	@echo "  App:    http://localhost:$(APP_PORT)"
	@echo ""
	@echo "$(YELLOW)Use 'tmux attach -t meme-vault' to view logs$(NC)"
	@echo "$(YELLOW)Use 'make stop' to stop all services$(NC)"

stop:
	@if tmux has-session -t meme-vault 2>/dev/null; then \
		tmux kill-session -t meme-vault; \
		echo "$(GREEN)Meme Vault stopped$(NC)"; \
	else \
		echo "$(YELLOW)Meme Vault not running$(NC)"; \
	fi
	@npx kill-port $(APP_PORT) 2>/dev/null || true
