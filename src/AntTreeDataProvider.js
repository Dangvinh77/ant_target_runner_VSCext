const vscode = require('vscode')
const fs = require('fs')
const xml2js = require('xml2js')
const _ = require('lodash')
const util = require('./util')
const path = require('path')

var configOptions

var extensionContext
var project
var selectedAntTarget

module.exports = class AntTreeDataProvider {
  constructor (context) {
    extensionContext = context

    this.targetRunner = null

    var workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      this.watchBuildXml(workspaceFolders)
    }

    // xml parser for build.xml file
    this._parser = new xml2js.Parser()

    // event for notify of change of data
    this._onDidChangeTreeData = new vscode.EventEmitter()
    this.onDidChangeTreeData = this._onDidChangeTreeData.event

    // trap config and workspaces changes to pass updates
    var onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this))
    extensionContext.subscriptions.push(onDidChangeConfiguration)

    var onDidChangeWorkspaceFolders = vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders.bind(this))
    extensionContext.subscriptions.push(onDidChangeWorkspaceFolders)

    this.getConfigOptions()
  }

  onDidChangeConfiguration () {
    this.getConfigOptions()
    this.refresh()
  }

  onDidChangeWorkspaceFolders () {
    var workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      this.watchBuildXml(workspaceFolders)
    }
  }

  watchBuildXml (workspaceFolders) {
    this.rootPath = workspaceFolders[0].uri.fsPath

    var fileSystemWatcher = vscode.workspace.createFileSystemWatcher(util.getRootFile(this.rootPath, 'build.xml'))
    extensionContext.subscriptions.push(fileSystemWatcher)

    fileSystemWatcher.onDidChange(() => {
      this._onDidChangeTreeData.fire()
    }, this, extensionContext.subscriptions)
    fileSystemWatcher.onDidDelete(() => {
      this._onDidChangeTreeData.fire()
    }, this, extensionContext.subscriptions)
    fileSystemWatcher.onDidCreate(() => {
      this._onDidChangeTreeData.fire()
    }, this, extensionContext.subscriptions)
  }

  getConfigOptions () {
    configOptions = vscode.workspace.getConfiguration('ant')
    this.sortTargetsAlphabetically = configOptions.get('sortTargetsAlphabetically', 'true')
  }

  refresh () {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem (element) {
    const TreeItem = vscode.TreeItem;
    if (element.contextValue === 'antFile') {
      let label = element.fileName;
      if (element.project) {
        label = element.fileName + '    (' + element.project + ')';
      }
      const treeItem = new TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      treeItem.contextValue = element.contextValue;
      treeItem.tooltip = element.filePath;
      return treeItem;
    } else if (element.contextValue === 'antTarget') {
      const treeItem = new TreeItem(element.name, element.depends ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      treeItem.contextValue = 'antTarget';
      treeItem.tooltip = element.description;
      treeItem.command = {
        arguments: [element.name],
        command: 'vscode-ant.selectedAntTarget',
        title: 'selectedAntTarget'
      };
      if (element.name === project.$.default) {
        treeItem.iconPath = {
          light: path.join(__filename, '..', '..', 'resources', 'icons', 'light', 'default.svg'),
          dark: path.join(__filename, '..', '..', 'resources', 'icons', 'dark', 'default.svg')
        };
      } else {
        treeItem.iconPath = {
          light: path.join(__filename, '..', '..', 'resources', 'icons', 'light', 'target.svg'),
          dark: path.join(__filename, '..', '..', 'resources', 'icons', 'dark', 'target.svg')
        };
      }
      return treeItem;
    } else if (element.contextValue === 'antDepends') {
      const treeItem = new TreeItem(element.name, element.depends ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      treeItem.contextValue = 'antDepends';
      treeItem.command = {
        arguments: [element.name],
        command: 'vscode-ant.selectedAntTarget',
        title: 'selectedAntTarget'
      };
      treeItem.iconPath = {
        light: path.join(__filename, '..', '..', 'resources', 'icons', 'light', 'dependency.svg'),
        dark: path.join(__filename, '..', '..', 'resources', 'icons', 'dark', 'dependency.svg')
      };
      return treeItem;
    } else {
      // fallback: return a minimal TreeItem if possible
      return new TreeItem(element.label || 'Unknown');
    }
  }

  getChildren (element) {
    if (!this.rootPath) {
      vscode.window.showInformationMessage('No build.xml in empty workspace.')
      return new Promise((resolve) => {
        resolve([])
      })
    }
    return new Promise((resolve) => {
      // add root element?
      if (!element) {
        this.getRoots()
          .then((roots) => {
            resolve(roots)
          })
          .catch((err) => {
            console.log(err)
            resolve([])
          })
      } else {
        if (element.contextValue === 'antFile' && element.filePath) {
          this.getTargetsInProject(project)
            .then((targets) => {
              resolve(targets)
            })
            .catch((err) => {
              console.log(err)
              resolve([])
            })
        } else if (element.contextValue === 'antTarget' && element.depends) {
          this.getDependsInTarget(element)
            .then((depends) => {
              resolve(depends)
            })
            .catch((err) => {
              console.log(err)
              resolve([])
            })
        } else if (element.contextValue === 'antDepends' && element.depends) {
          this.getDependsInTarget(element)
            .then((depends) => {
              resolve(depends)
            })
            .catch((err) => {
              console.log(err)
              resolve([])
            })
        } else {
          resolve([])
        }
      }
    })
  }

  getRoots () {
    return new Promise((resolve) => {
      var buildXml = util.getRootFile(this.rootPath, 'build.xml')
      if (util.pathExists(buildXml)) {
        fs.readFile(buildXml, 'utf-8', (err, data) => {
          if (err) {
            vscode.window.showErrorMessage('Error reading build.xml!')
            resolve([])
            return
          }
          this._parser.parseString(data, (err, result) => {
            if (err) {
              vscode.window.showErrorMessage('Error parsing build.xml!')
              resolve([])
              return
            } else {
              vscode.window.showInformationMessage('Targets loaded from build.xml!')
              project = this.setParentValues(result.project)

              var root = {
                contextValue: 'antFile',
                filePath: buildXml,
                fileName: 'build.xml'
              }
              if (project.$.name) {
                root.project = project.$.name
              }

              resolve([root])
            }
          })
        })
      } else {
        vscode.window.showInformationMessage('Workspace has no build.xml.')
        resolve([])
      }
    })
  }

  getTargetsInProject (buildXml) {
    return new Promise((resolve) => {
      var targets = project.target.map((target) => {
        var antTarget = {
          contextValue: 'antTarget',
          depends: target.$.depends,
          name: target.$.name
        }
        return antTarget
      })
      resolve(this._sort(targets))
    })
  }

  setParentValues (o) {
    if (o.target) {
      for (let n in o.target) {
        o.target[n].parent = o
        this.setParentValues(o.target[n])
      }
    }
    return o
  }

  getDependsInTarget (element) {
    return new Promise((resolve) => {
      var depends = element.depends.split(',').map((depends) => {
        var dependsTarget = {
          contextValue: 'antDepends',
          name: depends
        }
        // get details of this target
        var target = _.find(project.target, (o) => {
          if (o.$.name === depends && o.parent.target) {
            return true
          }
          return false
        })
        if (target) {
          dependsTarget.depends = target.$.depends
        }
        return dependsTarget
      })
      resolve(depends)
    })
  }

  selectedAntTarget (target) {
    selectedAntTarget = target
  }

  runSelectedAntTarget () {
    if (selectedAntTarget && this.targetRunner) {
      this.targetRunner.runAntTarget({name: selectedAntTarget})
    }
  }

  _sort (nodes) {
    if (!this.sortTargetsAlphabetically) {
      return nodes
    }

    return nodes.sort((n1, n2) => {
      if (n1.name < n2.name) {
        return -1
      } else if (n1.name > n2.name) {
        return 1
      } else {
        return 0
      }
    })
  }
}
