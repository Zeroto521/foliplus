.PHONY : help clean clean-build clean-pyc clean-cov clean-html lint dist build-js build-py test test-browser test-pythonhtml info

help:
	@echo "'clean'        - remove all build/cache artifacts"
	@echo "'clean-build'  - remove build artifacts"
	@echo "'clean-pyc'    - remove Python cache files"
	@echo "'clean-cov'    - remove coverage files"
	@echo "'clean-html'   - remove built documentation"
	@echo "'lint'         - run pre-commit hooks"
	@echo "'test'         - run all tests with coverage"
	@echo "'test-python'  - run Python-only tests (skip browser)"
	@echo "'test-browser' - run browser tests"
	@echo "'dist'         = build-js + build-py (full release)"
	@echo "'build-js'     - minify JS/CSS with esbuild to foliplus/dist/"
	@echo "'build-py'     - build sdist + wheel only"
	@echo "'html'         - build HTML docs in doc/_build/html"
	@echo "'info'         - show environment info"

clean-build:
	rm -fr build/
	rm -fr dist/
	rm -fr *.egg-info

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
	rm -rf foliplus/dist

lint:
	pre-commit run -a -v

dist: build-js build-py

build-js:
	node script/build.mjs

build-py:
	python -m build
	twine check --strict dist/*
	ls -l dist

# Parallel test workers. Use CPU count by default, override with JOBS=N.
JOBS ?= auto

test:
	build-js
	pytest -v -r a --color=yes -n $(JOBS) --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml test

test-python:
	build-js
	pytest -v -r a --color=yes -n $(JOBS) -m "not browser" --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml test

test-browser:
	build-js
	pytest -v -r a --color=yes -n $(JOBS) -m "browser" --cov=foliplus --cov-append --cov-report=term-missing --cov-report=xml test

html:
	cd doc/source && make html

info:
	@python -c "import platform,sys,os; print(f'Python: {sys.version.split()[0]}'); print(f'Platform: {platform.platform(terse=True)}')"
	@python -c "from foliplus import __version__; print(f'foliplus: {__version__}')"
	@python -c "import folium; print(f'folium: {folium.__version__}')"
	@python -c "import folium, os, re; folium_dir = os.path.dirname(folium.__file__); fp = os.path.join(folium_dir, 'folium.py'); c = open(fp).read(); m = re.search(r'leaflet@([\d.]+)', c); print(f'Leaflet: {m.group(1)}' if m else 'Leaflet: unknown')"
	@python -c "from foliplus._cdn import H3,CHROMA,GCOORD,SS; print(f'CDN: h3={H3} ss={SS} chroma={CHROMA} gcoord={GCOORD}')"
