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

function ImportError(module_name) {
    this.message = "Module '" + module_name + "' not found";
}
util.inherits(ImportError, Error);
ImportError.prototype.name = 'ImportError';

function RecursiveImportError(stack) {
    this.message = "Recursive imports are not allowed (" + stack.join(' -> ') + ")";
}
util.inherits(RecursiveImportError, ImportError);
RecursiveImportError.prototype.name = 'RecursiveImportError';

function AbstractModule(filename, name) {
    this.filename = filename;
    this.name = name;

    if (name) {
        this.alias = /(?:^|\.)([^\.]+)$/.exec(name)[1];
    }
};

function Module(source, filename, name) {
    AbstractModule.call(this, filename, name);
    this.source = source;
}

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

function ExportedModule(filename, name) {
    AbstractModule.call(this, filename, name);

    var source = fs.readFileSync(filename, ENCODING),
        sandbox = vm.createContext();

    vm.runInNewContext(source, sandbox, filename);
    this.dump = sandbox.dump;
}

ExportedModule.prototype.build = function () {
    this.imports = [];
    this.body = this.dump();
}

Module.normalizeName = function (basename, name) {
    if (name.substr(0, 1) === '.') {
        if (basename) {
            return basename + name;
        }

        return name.substr(1);
    }

    return name;
};

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

function ModuleBuilder(folder) {
    this.folder = folder;
    this.buffer = [];
    this.modules_count = 0;
    this.exports = {};
}

ModuleBuilder.prototype = {
    write: function () {
        [].push.apply(this.buffer, arguments);
    },

    dump: function () {
        return this.buffer.join('');
    },

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

        body_builder();

        this.write(
            '\n}(',
                imports.map(function (i) { return i.varname }).join(', '),
            '))'
        );
    },

    writeModule: function (module_name, stack) {
        var that = this,
            module = Module.load(this.folder, module_name),
            varname;

        module.build(this, stack.concat(module_name));
        varname = '__module_' + this.modules_count++;

        this.write(
            this.modules_count == 1 ? 'var ' : ',\n',
            varname, ' = ', '/* ', module_name, ' */ '
        );

        this.writeIIFE(module.imports, function () {
            that.write(
                module.body, '\n',
                'if (typeof ', module.alias, ' !== \'undefined\') { return ', module.alias, ' }'
            );
        });

        return {alias: module.alias, varname: varname};
    },

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
}

exports.buildFile = function (filename) {
    process.stdout.write(
       build(fs.readFileSync(filename, ENCODING), path.dirname(filename))
    );
}

exports.buildFile('test/root.js');
