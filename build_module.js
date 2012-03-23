#!/usr/bin/env node

var fs = require('fs'),
    assert = require('assert'),
    path = require('path'),
    util = require('util'),
    vm = require('vm');

    ENCODING = 'utf-8',
    COMMAND_PATTERN = /\/\/\s+#(.+)|\/\*[\s\r\n]+#([\s\S]+?)\*\//g,
    COMMAND_ARGS_PATTERN = /^(.+?)(?:[\s\r\n]+([\s\S]+))?$/;

function repr() {
    console.log.apply(console, [].map.call(arguments, JSON.stringify));
}

/**
 * Map commands found in source string to function calls
 *
 * @param {String} source
 * @param {Function} callback   Callback function with command name and args
 *  arguments. Result of this function gets inserted in place of command.
 * @return {String}
 */
function mapCommands(source, callback) {
    return source.replace(COMMAND_PATTERN, function (source_value, match_1, match_2) {
        var match = COMMAND_ARGS_PATTERN.exec(match_1 || match_2),
            replace_value = callback(match[1], match[2]);

        if (replace_value == null) {
            return '';
        }

        return replace_value;
    });
};

/**
 * Creates ImportError exception instance. Thrown when imported module cannot be found.
 *
 * @constructor
 * @param {String} module_name Name of module which cannot be found.
 */
function ImportError(module_name) {
    this.message = "Module '" + module_name + "' not found";
}
util.inherits(ImportError, Error);
ImportError.prototype.name = 'ImportError';

/**
 * Creates RecursiveImportError exception instance. Thrown on recursive imports.
 *
 * @constructor
 * @param {String[]} stack Import stack.
 */
function RecursiveImportError(stack) {
    this.message = "Recursive imports are not allowed (" + stack.join(' -> ') + ")";
}
util.inherits(RecursiveImportError, ImportError);
RecursiveImportError.prototype.name = 'RecursiveImportError';

/**
 * Creates AbstractModule instance.
 *
 * @constructor
 * @param {String} [filename] Module filename.
 * @param {String} [name]     Module name.
 */
function AbstractModule(filename, name) {
    this.filename = filename;
    this.name = name;

    if (name) {
        this.alias = /(?:^|\.)([^\.]+)$/.exec(name)[1];
    }
};

/**
 * Creates Module instance.
 *
 * @constructor
 * @param {String} source   Module source.
 * @param {String} [filename] Module filename.
 * @param {String} [name]     Module name.
 */
function Module(source, filename, name) {
    AbstractModule.call(this, filename, name);
    this.source = source;
}

/**
 * Builds module and sets body and imports properties.
 *
 * @param {ModuleBuilder} builder Module builder which resolves imports.
 * @param {String[]} [stack]      Stack for detecting import recursion.
 */
Module.prototype.build = function (builder, stack) {
    var imports = this.imports = [];

    this.body = mapCommands(this.source, function (command, args) {
        assert(command === 'import', "Unknown command '" + command + "'");

        args.split(',').forEach(function (module_import) {
            var match = /^(.+?)(?:[\s\r\n]+as[\s\r\n]+(.+?)$)?$/.exec(module_import.trim()),
                import_export = builder.resolveImport(match[1], stack),
                import_alias = match[2];

            imports.push({
                varname: import_export.varname,
                alias: import_alias || import_export.alias
            });
        });
    });
};

/**
 * Creates ExportedModule instance.
 *
 * @constructor
 * @param {String} filename Module filename.
 * @param {String} name     Module name.
 */
function ExportedModule(filename, name) {
    AbstractModule.call(this, filename, name);

    var source = fs.readFileSync(filename, ENCODING),
        sandbox = vm.createContext();

    vm.runInNewContext(source, sandbox, filename);
    this.dump = sandbox.dump;
}

/**
 * Builds module and sets body and imports properties.
 */
ExportedModule.prototype.build = function () {
    this.imports = [];
    this.body = this.dump();
}

/**
 * Normalizes module names to absolute names.
 *
 * @param {String} basename Parent module absolute name.
 * @param {String} name     Module name.
 * @return {String}         Module absolute name.
 */
Module.normalizeName = function (basename, name) {
    if (name.substr(0, 1) === '.') {
        if (basename) {
            return basename + name;
        }

        return name.substr(1);
    }

    return name;
};

/**
 * Loads module
 *
 * @param {String} folder       Library folder.
 * @param {String} module_name  Module name.
 * @return {Module|ExportedModule}  Module object.
 */
Module.load = function (folder, module_name) {
    var module_subpath = module_name.split('.'),
        module_location = folder,
        js_filename;

    while (module_subpath.length) {
        module_location = path.join(module_location, module_subpath.shift());

        if (path.existsSync(js_filename = module_location + '.export.js')) {
            // foo.bar.baz -> foo/bar.export.js
            return new ExportedModule(js_filename, module_name);
        }

        if (!module_subpath.length) {
            if (path.existsSync(js_filename = module_location + '.js')) {
                // foo.bar.baz -> foo/bar/baz.js
                return new Module(fs.readFileSync(js_filename, ENCODING), js_filename, module_name);
            }

            if (path.existsSync(js_filename = path.join(module_location, '^.js'))) {
                // foo.bar.baz -> foo/bar/baz/^.js
                return new Module(fs.readFileSync(js_filename, ENCODING), js_filename, module_name);
            }
        } else if (!path.existsSync(path.join(module_location, '^.js'))) {
            // traverse into module folders only
            break;
        }
    }

    throw new ImportError(module_name);
};

/**
 * Creates ModuleBuilder instance.
 *
 * @class Module builder is a stream which can be written and imports resolver.
 * @param {String} folder   Library folder.
 */
function ModuleBuilder(folder) {
    this.folder = folder;
    this.buffer = [];
    this.modules_count = 0;
    this.exports = {};
}

ModuleBuilder.prototype = {
    /**
     * Writes to a stream.
     */
    write: function () {
        [].push.apply(this.buffer, arguments);
    },

    /**
     * Dumps written data.
     *
     * @returns {String}    Data written to a stream.
     */
    dump: function () {
        return this.buffer.join('');
    },

    /**
     * Writes immediately-invoked function expression (IIFE) to a stream.
     *
     * @param {Object[]} imports    List of function arguments.
     * @param {Function} body_builder    Function which builds function body.
     */
    writeIIFE: function (imports, body_builder) {
        if (arguments.length === 1) {
            body_builder = imports;
            imports = [];
        }

        this.write(
           '(function (',
               imports.map(function (i) { return i.alias }).join(', '),
           ') {\n'
        );

        body_builder.call(this);

        this.write(
            '\n}(',
                imports.map(function (i) { return i.varname }).join(', '),
            '))'
        );
    },

    /**
     * Loads and writes Module to a stream.
     *
     * @param {String} module_name  Module absolute name.
     * @param {String[]} stack      Module import stack.
     * @returns {Object} Module export (alias and varname).
     */
    writeModule: function (module_name, stack) {
        var module = Module.load(this.folder, module_name),
            varname;

        module.build(this, stack.concat(module_name));
        varname = '__module_' + this.modules_count++;

        this.write(
            this.modules_count == 1 ? 'var ' : ',\n',
            varname, ' = ', '/* ', module_name, ' */ '
        );

        this.writeIIFE(module.imports, function () {
            this.write(
                module.body, '\n',
                'if (typeof ', module.alias, ' !== \'undefined\') { return ', module.alias, ' }'
            );
        });

        return {alias: module.alias, varname: varname};
    },

    /**
     * Resolves import directive.
     *
     * @param {String} module_name  Module name.
     * @param {String[]} stack      Module import stack.
     * @returns {Object} Module export.
     */
    resolveImport: function (module_name, stack) {
        var module_export;

        stack = stack || [];
        module_name = Module.normalizeName(
            stack.length ? stack[stack.length - 1] : null,
            module_name
        );
        module_export = this.exports[module_name];

        if (!module_export) {
            if (stack.indexOf(module_name) !== -1) {
                throw new RecursiveImportError(stack.concat(module_name));
            }

            module_export = this.exports[module_name] = this.writeModule(module_name, stack);
        }

        return module_export;
    }
};

/**
 * Builds library.
 *
 * @param {String} source   Library source.
 * @param {String} folder   Library folder.
 * @return {String} Library dump.
 */
function build(source, folder) {
    var builder = new ModuleBuilder(folder);
        module = new Module(source);

    builder.writeIIFE(function () {
        module.build(builder);

        if (module.imports.length) {
            builder.write(';\n');
            builder.writeIIFE(module.imports, function () {
                builder.write(module.body);
            });
            builder.write(';');
        } else {
            builder.write(module.body);
        }
    });

    builder.write(';\n');

    return builder.dump();
}

/**
 * Builds library from stdin.
 */
exports.buildStdin = function () {
    process.stdin.setEncoding(ENCODING);
    process.stdin
        .on('data', function (data) {
            process.stdout.write(build(data));
        })
        .on('end', function (data) {
            process.exit();
        })
        .resume();
};

/**
 * Builds library from file.
 *
 * @param {String} filename   Library filename.
 */
exports.buildFile = function (filename) {
    process.stdout.write(
       build(fs.readFileSync(filename, ENCODING), path.dirname(filename))
    );
};

exports.buildStdin();
