.PHONY : help
.PHONY: lint html info env
.PHONY: dist build-js build-js-dev build-python
.PHONY: test test-browser test-python test-js
.PHONY: clean clean-build clean-pyc clean-cov clean-html

help:
	@echo "'clean'        - remove all build/cache artifacts"
	@echo "'lint'         - run pre-commit hooks"
	@echo "'html'         - build HTML docs in doc/_build/html"
	@echo "'info'         - show environment info"
	@echo "'env'          - bootstrap per-worktree .venv with uv"
	@echo "'dist'         - build-js + build-python (full release)"
	@echo "'build-js'     - minify JS/CSS with esbuild to foliplus/dist/"
	@echo "'build-js-dev' - build JS/CSS without minification (for tests)"
	@echo "'build-python' - build sdist + wheel only"
	@echo "'test'         - run all tests with coverage"
	@echo "'test-browser' - run browser tests"
	@echo "'test-python'  - run Python-only tests (skip browser)"
	@echo "'test-js'      - run JS tests (skip Python)"
	@echo "'clean-build'  - remove build artifacts"
	@echo "'clean-pyc'    - remove Python cache files"
	@echo "'clean-cov'    - remove coverage files"
	@echo "'clean-html'   - remove built documentation"

clean-build:
	rm -rf *.egg-info
	rm -rf build/
	rm -rf dist/
	rm -rf foliplus/.build
	rm -rf foliplus/dist

clean-pyc:
	find . -name '*.pyc' -exec rm -f {} +
	find . -name '*.pyo' -exec rm -f {} +
	find . -name '*~' -exec rm -f {} +

clean-cov:
	rm -rf coverage.xml .coverage coverage/

clean-html:
	rm -rf doc/_build
	rm -rf doc/source/_build

clean: clean-build clean-pyc clean-cov clean-html

lint:
	pre-commit run -a -v

dist: build-js build-python

build-js:
	npm run build

build-js-dev:
	npm run build:dev

build-python:
	python -m build
	twine check --strict dist/*
	ls -l dist

# Parallel test workers. Use CPU count by default, override with JOBS=N.
JOBS ?= auto
PYTHON_VERSION := $(shell cat .python-version)

test: build-js-dev test-js
	pytest -v -r a --color=yes -n $(JOBS) --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml --junitxml=junit.xml -o junit_family=legacy test/python

test-python: build-js-dev
	pytest -v -r a --color=yes -n $(JOBS) -m "not browser" --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml --junitxml=junit.xml -o junit_family=legacy test/python

test-browser: build-js-dev
	pytest -v -r a --color=yes -n $(JOBS) -m "browser" --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml --junitxml=junit-browser.xml -o junit_family=legacy test/python

test-js:
	npm test

html:
	cd doc/source && make html

info:
	@python -c "import platform,sys,os; print(f'Python: {sys.version.split()[0]}'); print(f'Platform: {platform.platform(terse=True)}')"
	@python -c "from foliplus import __version__; print(f'foliplus: {__version__}')"
	@python -c "import folium; print(f'folium: {folium.__version__}')"
	@python -c "import folium, os, re; folium_dir = os.path.dirname(folium.__file__); fp = os.path.join(folium_dir, 'folium.py'); c = open(fp).read(); m = re.search(r'leaflet@([\d.]+)', c); print(f'Leaflet: {m.group(1)}' if m else 'Leaflet: unknown')"
	@python -c "from foliplus._cdn import H3,CHROMA,GCOORD,SS; print(f'CDN: h3={H3} ss={SS} chroma={CHROMA} gcoord={GCOORD}')"

env:
	@command -v uv >/dev/null 2>&1 || { echo "uv not found: https://docs.astral.sh/uv/getting-started/installation"; exit 1; }
	uv venv -p $(PYTHON_VERSION)
	uv pip install -e ".[dev]"
	@echo "Done. Then: source .venv/bin/activate"
	@echo "For browser tests also run: playwright install chromium"
