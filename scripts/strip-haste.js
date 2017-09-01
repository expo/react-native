require('../setupBabel')();

const babel = require('babel-core');
const babylon = require('babylon');
const fs = require('fs');
const JestHasteMap = require('jest-haste-map');
const _ = require('lodash');
const path = require('path');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');

const packagerDefaults = require('metro-bundler/src/defaults');

const ROOTS = [
  path.resolve(__dirname, '..', 'Libraries'),
  path.resolve(__dirname, '..', 'jest'),
  path.resolve(__dirname, '..', 'integrationTests'),
  path.resolve(__dirname, '..', 'RNTester'),
];

const LibrariesDest = path.resolve(__dirname, '..', 'Libraries');

const ignoreREs = [];

async function main() {
  // console.log('Cleaning...');
  // rimraf.sync(LibrariesDest);

  const haste = createHasteMap();
  console.log('Loading dependency graph...');
  const { moduleMap } = await haste.build();
  console.log('Loaded dependency graph.');
  // await transformRequires({
  //   source: ROOTS[1],
  //   dest: ROOTS[1],
  //   moduleMap: moduleMap.getRawModuleMap().map,
  // });
  for (let rootDir of ROOTS) {
    await transformRequires({
      source: rootDir,
      dest: rootDir,
      moduleMap: moduleMap.getRawModuleMap().map,
    });
  }
}

async function transformRequires({ source, dest, moduleMap }) {
  const sourceDir = fs.readdirSync(source);
  for (let filename of sourceDir) {
    const filePath = path.resolve(source, filename);
    if (_.some(ignoreREs.map(r => filePath.match(r)))) {
      continue;
    }
    const fileStats = fs.statSync(filePath);
    if (fileStats.isDirectory()) {
      await transformRequires({
        source: filePath,
        dest: path.join(dest, filename),
        moduleMap,
      });
    } else {
      await _transformRequiresInFile(
        filePath,
        path.join(dest, filename),
        moduleMap
      );
    }
  }
}

function _transformRequiresInFile(sourceFilePath, destFilePath, moduleMap) {
  const dirname = path.dirname(destFilePath);
  // Make the directory if it doesn't exist
  mkdirp.sync(dirname);

  // If not a JS file, just copy the file
  if (!sourceFilePath.endsWith('.js')) {
    // console.log(`Writing ${destFilePath}...`);
    // fs
    //   .createReadStream(sourceFilePath)
    //   .pipe(fs.createWriteStream(destFilePath));
    return;
  }

  // Get dependencies
  const code = fs.readFileSync(sourceFilePath, 'utf8');
  console.log(`Writing ${destFilePath}...`);
  const { dependencyOffsets, dependencies } = extractDependencies(code);

  const dependencyMap = dependencies.reduce((result, dep, i) => {
    if (!moduleMap[dep]) {
      return result;
    }

    const mod = moduleMap[dep];
    let modulePath;
    if (mod.g) {
      modulePath = mod.g[0];
    } else if (mod.ios) {
      modulePath = mod.ios[0];
    } else if (mod.android) {
      modulePath = mod.android[0];
    } else {
      return result;
    }

    let depPath = path.relative(path.dirname(sourceFilePath), modulePath);
    if (!depPath.startsWith('.')) {
      depPath = `./${depPath}`;
    }
    depPath = depPath.replace(/(.*)\.[^.]+$/, '$1'); // remove extension
    depPath = depPath.replace(/(.*).(android|ios)/, '$1'); // remove platform ext

    return Object.assign({}, result, {
      [dep]: {
        offset: dependencyOffsets[i],
        replacement: depPath,
      },
    });
  }, {});

  const newCode = dependencyOffsets
    .reduceRight(
      ([unhandled, handled], offset) => [
        unhandled.slice(0, offset),
        replaceDependency(unhandled.slice(offset) + handled, dependencyMap),
      ],
      [code, '']
    )
    .join('');

  fs.writeFileSync(destFilePath, newCode);
}

function createHasteMap() {
  return new JestHasteMap({
    extensions: packagerDefaults.sourceExts.concat(packagerDefaults.assetExts),
    maxWorkers: 1,
    ignorePattern: filepath => {
      return (
        filepath.indexOf('__tests__') !== -1 ||
        filepath.indexOf('__mocks__') !== -1
      );
    },
    mocksPattern: '',
    platforms: packagerDefaults.platforms,
    providesModuleNodeModules: [],
    resetCache: true,
    retainAllFiles: true,
    roots: ROOTS,
    useWatchman: true,
    watch: false,
  });
}

const reDepencencyString = /^(['"])([^'"']*)\1/;
function replaceDependency(stringWithDependencyIDAtStart, dependencyMap) {
  const match = reDepencencyString.exec(stringWithDependencyIDAtStart);
  const dependencyName = match && match[2];
  if (match != null && dependencyName in dependencyMap) {
    const { length } = match[0];
    const { replacement } = dependencyMap[dependencyName];
    return `'${replacement}'` + stringWithDependencyIDAtStart.slice(length);
  } else {
    return stringWithDependencyIDAtStart;
  }
}

/**
 * Extracts dependencies (module IDs imported with the `require` function) from
 * a string containing code. This walks the full AST for correctness (versus
 * using, for example, regular expressions, that would be faster but inexact.)
 *
 * The result of the dependency extraction is an de-duplicated array of
 * dependencies, and an array of offsets to the string literals with module IDs.
 * The index points to the opening quote.
 */
function extractDependencies(code) {
  const ast = babylon.parse(code, {
    sourceType: 'module',
    plugins: [
      'classProperties',
      'jsx',
      'flow',
      'exportExtensions',
      'asyncGenerators',
      'objectRestSpread',
    ],
  });
  const dependencies = new Set();
  const dependencyOffsets = [];
  const types = require('babel-types');

  const transformedFunctions = [
    'require',
    'require.resolve',
    'require.requireActual',
    'require.requireMock',
    'System.import',
    'mockComponent',
  ];

  const isJest = node => {
    try {
      let callee;
      if (node.isCallExpression()) {
        callee = node.get('callee');
      } else if (node.isMemberExpression()) {
        callee = node;
      }
      return (
        callee.get('object').isIdentifier({ name: 'jest' }) ||
        (callee.isMemberExpression() && isJest(callee.get('object')))
      );
    } catch (e) {
      return false;
    }
  };

  const isValidJestFunc = node => {
    return (
      node.isIdentifier({ name: 'mock' }) ||
      node.isIdentifier({ name: 'unmock' }) ||
      node.isIdentifier({ name: 'doMock' }) ||
      node.isIdentifier({ name: 'dontMock' }) ||
      node.isIdentifier({ name: 'setMock' }) ||
      node.isIdentifier({ name: 'genMockFromModule' })
    );
  };

  const transformCall = nodePath => {
    if (isJest(nodePath)) {
      const calleeProperty = nodePath.get('callee.property');
      if (isValidJestFunc(calleeProperty)) {
        const arg = nodePath.get('arguments.0');
        if (!arg || arg.type !== 'StringLiteral') {
          return;
        }
        dependencyOffsets.push(parseInt(arg.node.start, 10));
        dependencies.add(arg.node.value);
      }
    } else {
      const calleePath = nodePath.get('callee');
      const isNormalCall = transformedFunctions.some(pattern =>
        _matchesPattern(types, calleePath, pattern)
      );
      if (isNormalCall) {
        const arg = nodePath.get('arguments.0');
        if (!arg || arg.type !== 'StringLiteral') {
          return;
        }
        dependencyOffsets.push(parseInt(arg.node.start, 10));
        dependencies.add(arg.node.value);
      }
    }
  };

  babel.traverse(ast, {
    CallExpression: transformCall,
  });

  return {
    dependencyOffsets: [...dependencyOffsets].sort((a, b) => a - b),
    dependencies: Array.from(dependencies),
  };
}

function _matchesPattern(types, calleePath, pattern) {
  const { node } = calleePath;

  if (types.isMemberExpression(node)) {
    return calleePath.matchesPattern(pattern);
  }

  if (!types.isIdentifier(node) || pattern.includes('.')) {
    return false;
  }

  const name = pattern.split('.')[0];

  return node.name === name;
}

main().catch(e => {
  console.trace(e);
  throw e;
});
