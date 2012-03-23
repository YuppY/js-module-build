# Javascript Module Builder

Tool for building javascript libraries by processing special directives in code:

```javascript
// #directive argument

/*
    #multiline-directive
        argument1,
        argument2
*/
```

## `#import` directive

Declares module or library dependency. Syntax:

```
#import module1[ as alias1][,... moduleN[ as aliasN]]
```

All modules are running in separate local scopes. They have two options to
export values: to define local variable with same name as module (good option)
or to define global variable (bad option).

For example, if we building `lib.js`:

```javascript
// #import some_module

var value = module.doSomething();
console.log(value);
```

And `some_module.js` is:

```javascript
var some_module = {
    doSomething: function () {
        return Math.random();
    }
};
```

Then resulting code is:

```javascript
(function () {
    var __module_0 = (function () {

// begin: some_module.js
var some_module = {
    doSomething: function () {
        return Math.random();
    }
};
// end: some_module.js

        if (typeof some_module !== 'undefined') { return some_module }
    }());

    (function (some_module) {

// begin: lib.js
var value = some_module.doSomething();
console.log(value);
// end: lib.js

    }(__module_0));
}());
```

### Packages

Modules can be grouped into packages:

```
lib.js
example_package/
    ^.js
    example_module_A.js
    example_module_B.js
```

`^.js` is root package module. It indicates that folder is package and contains
code of module associated with package name.

`lib.js`:

```javascript
/*
    #import
        example_package,
        example_package.example_module_A,
        example_package.example_module_B as B
*/

// variable names are:

example_package;    // value from example_package/^.js
example_module_A;   // value from example_package/example_module_A.js
B;                  // value from example_package/example_module_B.js
```

Import paths can be relative:

`example_package/^.js`:

```javascript
// #import .example_module_B
// same as:
// #import example_package.example_module_B
```

And resulting library will be:

```javascript
(function () {
    var __module_0 = (function () {
            // example_package/example_module_B.js code
        }()),
        __module_1 = (function (example_module_B, example_module_B) {
            // example_package/^.js code
        }(__module_0, __module_0)),
        __module_2 = (function () {
            // example_package/example_module_A.js code
        }());

    (function (example_package, example_module_A, B) {
        // lib.js code
    }(__module_0, __module_2, __module_1));
}());
```

### Exported modules

Module source can be built with plain javascript instead of directives. This
can be useful for building json configuration from external sources. Exported
module should contain function named `dump` and filename ending with `.export.js`.

For instance `build_date.export.js`:

```javascript
function dump() {
    return 'var build_date = ' + JSON.stringify(String(new Date())) + ';';
}
```

`lib.js`:

```javascript
#import build_date

window.getBuildDate = function () {
    alert('This library was built on ' + build_date);
};
```
