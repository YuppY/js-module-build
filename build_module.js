#!/usr/bin/env node

var fs = require('fs'),
    assert = require('assert'),
    path = require('path'),
    util = require('util'),
    vm = require('vm');

    ENCODING = 'utf-8',
    PATTERN = /\/\/\s+#(.+)|\/\*[\s\r\n]+#([\s\S]+?)\*\//g;

function repr() {
	console.log.apply(console, [].map.call(arguments, JSON.stringify));
}

function _remove_duplicates(array) {
	var i = 0,
	    value,
	    visited = {};

	while (i < array.length) {
		value = array[i];

        if (visited[value]) {
        	array.splice(i, 1);
        } else {
        	visited[value] = true;
        	i++;
        }
	}
}

function mapCommands(source, callback) {
	var command_args_pattern = /^(.+?)(?:[\s\r\n]+([\s\S]+))?$/;

	return source.replace(PATTERN, function (source_value, match_1, match_2) {
        var match = command_args_pattern.exec(match_1 || match_2),
            replace_value = callback(match[1], match[2]);

        //repr(source_value)

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

function dumpModuleExport(source, subpath) {
	var sandbox = vm.createContext();
	vm.runInNewContext(source, sandbox);
	return sandbox.dump(subpath);
}

function readModuleSource(folder, module_path) {
    var module_subpath = module_path.split('.'),
        module_location = folder,
        js_filename;

    while (module_subpath.length) {
    	module_location = path.join(module_location, module_subpath.shift());

        if (path.existsSync(js_filename = module_location + '.export.js')) {
            // foo.bar.baz -> foo/bar.export.js
        	return dumpModuleExport(fs.readFileSync(js_filename, ENCODING), module_subpath);
        }

    	if (!module_subpath.length) {
            if (path.existsSync(js_filename = module_location + '.js')) {
                // foo.bar.baz -> foo/bar/baz.js
                return fs.readFileSync(js_filename, ENCODING);
            }

            if (path.existsSync(js_filename = path.join(module_location, '^.js'))) {
                // foo.bar.baz -> foo/bar/baz/^.js
                return fs.readFileSync(js_filename, ENCODING);
            }
    	} else if (!path.existsSync(path.join(module_location, '^.js'))) {
    		// traverse into module folders only
            break;
        }
	}

	throw new ImportError(module_path);
};

function normalizeModuleName(basename, name) {
	if (name.substr(0, 1) === '.') {
		if (basename) {
            return basename + name;
		}

		return name.substr(1);
	}

	return name;
};

function IIFE(body_buffer, imports) {
	var result;

	imports = imports || [];

	result = [
       '(function (',
           imports.map(function (i) { return i.alias }).join(', '),
       ') {\n'
    ];

    [].push.apply(result, body_buffer);

    result.push(
        '\n}(',
            imports.map(function (i) { return i.varname }).join(', '),
        '))'
    );

	return result;
};

function ModuleBuilder(folder) {
	this.folder = folder;
	this.buffer = [];
	this.modules_count = 0;
	this.exports = {};
}

ModuleBuilder.prototype.load = function (module_name, stack) {
	var source = readModuleSource(this.folder, module_name),
	    module_alias = /(?:^|\.)([^\.]+)$/.exec(module_name)[1],
	    module_buffer = this.runCommands(source, [].concat(stack, module_name), module_alias),
	    module_export = {
            varname: '__module_' + this.modules_count++,
            alias: module_alias
        };

	this.buffer.push(
        this.modules_count == 1 ? 'var ' : ',\n',
        module_export.varname, ' = ', '/* ', module_name, ' */ '
    );

    [].push.apply(this.buffer, module_buffer);

	return module_export;
}

ModuleBuilder.prototype.resolveImport = function (module_name, stack) {
    var module_export;

    stack = stack || [];
    module_name = normalizeModuleName(
        stack.length ? stack[stack.length - 1] : null,
        module_name
    );
    module_export = this.exports[module_name];

    if (!module_export) {
    	if (stack.indexOf(module_name) !== -1) {
    		throw ImportError(
                'Recursive import: '
                + stack.concat(module_name).join(' -> ')
            );
    	}

        module_export = this.exports[module_name] = this.load(module_name, stack);
    }

    return module_export;
};

ModuleBuilder.prototype.runCommands = function (source, stack, module_alias) {
    var that = this,
        module_imports = [],

        // formatting body and making lists of dependencies
        body = [mapCommands(source, function (command, args) {
            assert(command === 'import', "Unknown command '" + command + "'");

            args.split(',').forEach(function (module_import) {
                var match = /^(.+?)(?:[\s\r\n]+as[\s\r\n]+(.+?)$)?$/.exec(module_import.trim()),
                    import_export = that.resolveImport(match[1], stack),
                    import_alias = match[2];

                module_imports.push({
                    varname: import_export.varname,
                    alias: import_alias || import_export.alias
                });
            });
        })];

    if (module_alias) {
    	body.push(
           '\nif (typeof ', module_alias, ' !== \'undefined\') { return ', module_alias, ' }'
        );
    }

    return IIFE(body, module_imports);
};

ModuleBuilder.prototype.build = function (source) {
    var source_buffer = this.runCommands(source);

    if (!this.buffer.length) {
        // no imports
        return source_buffer.join('');
    }

    return IIFE(this.buffer.concat(';\n', source_buffer, ';')).join('');
};

function build(source, folder) {
	var builder = new ModuleBuilder(folder);
	return builder.build(source);

/*
	var imports = [],
	    result = mapCommands(source, function (command, args) {
            assert(command === 'import', "Unknown command '" + command + "'");

            args.split(',').forEach(function (module) {
            	var match = /^(.+?)(?:[\s\r\n]+as[\s\r\n]+(.+?)$)?$/.exec(module.trim());

            	if (match[2]) {
            		// module alias
            		repr(match[2]);
            	}

            	resolveModule(match[1], module_path);

                imports.push(module.trim());
            });
    	});

	_remove_duplicates(imports);
	repr(imports);
*/

/*
	function _closure(module) {
        return '(function ('
                + module.imports.map(function (i) { return i.alias }).join(', ')
            + ') {\n'
                + module.source
                + (module.name ?
                    '\nif (typeof ' + module.name + ' !== \'undefined\') { return ' + module.name + '}\n' :
                    '')
            + '})('
                + module.imports.map(function (i) {
                    return '__modules_' + modules.indexOf(i.module) + ''
                }).join(', ')
            + ')';
	}

    return '(function () {\n' + (
        modules_order.length ?

            'var ' + modules_order.map(function (module, i) {
                return '__modules_' + i + ' = ' + _closure(module);
            }).join(',\n') + ';\n'
            + _closure(module) :

            module.source
    ) + '\n})();';
*/
};

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
