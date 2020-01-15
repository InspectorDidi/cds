import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit, ViewChild } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Pipeline } from 'app/model/pipeline.model';
import { Project } from 'app/model/project.model';
import { PipelineCoreService } from 'app/service/pipeline/pipeline.core.service';
import { ThemeStore } from 'app/service/theme/theme.store';
import { AutoUnsubscribe } from 'app/shared/decorator/autoUnsubscribe';
import { ToastService } from 'app/shared/toast/ToastService';
import { FetchAsCodePipeline, ImportPipeline, PreviewPipeline, ResyncPipeline } from 'app/store/pipelines.action';
import { Subscription } from 'rxjs';
import { finalize, first } from 'rxjs/operators';
import * as yaml from 'js-yaml';
import { Schema } from 'js-yaml';
import { FlatSchema, JSONSchema } from 'app/model/schema.model';
import { UserService } from 'app/service/user/user.service';
import { Validator } from 'jsonschema';

declare var CodeMirror: any;

@Component({
    selector: 'app-pipeline-ascode-editor',
    templateUrl: './pipeline.ascode.editor.html',
    styleUrls: ['./pipeline.ascode.editor.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
@AutoUnsubscribe()
export class PipelineAsCodeEditorComponent implements OnInit {
    @ViewChild('codeMirror', {static: false}) codemirror: any;

    // Project that contains the pipeline
    @Input() project: Project;
    @Input() pipeline: Pipeline;
    // Flag indicate if sidebar is open
    @Input('open')
    set open(data: boolean) {
        if (data && !this.updated) {
            this.store.dispatch(new FetchAsCodePipeline({
                projectKey: this.project.key,
                pipelineName: this.pipeline.name
            })).pipe(finalize(() => {
                this._cd.markForCheck();
            }))
                .subscribe(() => this.exportedPip = this.pipeline.asCode);
        }
        this._open = data;
    }
    get open() {
        return this._open;
    }
    _open = false;

    asCodeEditorSubscription: Subscription;
    codeMirrorConfig: any;
    updated = false;
    loading = false;
    previewMode = false;
    exportedPip = '';
    themeSubscription: Subscription;

    pipelineSchema: Schema;
    flatSchema: FlatSchema;
    viewInit: boolean;

    constructor(
        private store: Store,
        private _pipCoreService: PipelineCoreService,
        private _toast: ToastService,
        private _translate: TranslateService,
        private _theme: ThemeStore,
        private _cd: ChangeDetectorRef,
        private _userService: UserService
    ) {
        this.codeMirrorConfig = {
            mode: 'text/x-yaml',
            lineWrapping: true,
            lineNumbers: true,
            autoRefresh: true,
            tabSize: 2,
            indentWithTabs: false,
            gutters: ['CodeMirror-lint-markers'],
            lint: {
                getAnnotations: this.pipelineCheck
            }
        };
        this._userService.getSchema('pipeline').pipe(first()).subscribe(sc => {
            if (sc.pipeline) {
                this.pipelineSchema = <Schema>JSON.parse(sc.pipeline);
                this.flatSchema = JSONSchema.flat(this.pipelineSchema);
                console.log(this.flatSchema);
                if (this.viewInit) {
                    this.initCodeMirror();
                }
            }

        })
    }

    ngAfterViewInit(): void {
        this.viewInit = true;
        if (this.pipelineSchema) {
            this.initCodeMirror();
        }
    }
    initCodeMirror(): void {
        this.codemirror.instance.on('keyup', (cm, event) => {
            if (event.which > 46 || event.which === 32) {
                console.log(event);
                CodeMirror.showHint(cm, CodeMirror.hint.asCode, {
                    completeSingle: true,
                    closeCharacters: / /,
                    specialChars: '',
                    schema: this.flatSchema
                });
            }
        });
    }

    pipelineCheck = cm => {
        const errors = CodeMirror.lint.yaml(cm);
        if (errors && errors.length > 0) {
            return errors;
        }
        if (!cm) {
            return [];
        }

        if (!this.pipelineSchema) {
            return [];
        }

        const yamlData = yaml.load(cm);
        let v = new Validator();
        let result = v.validate(yamlData, this.pipelineSchema);
        return this.toCodemirrorError(<[]>result.errors);
    };

    toCodemirrorError(errors: []) {
        let errs = [];
        if (errors) {
            errors.forEach(e => {
                errs.push({
                    from: {
                        ch: 1,
                        line: 1
                    },
                    message: e['message']
                });
            });
        }
        return errs;
    }

    ngOnInit(): void {
        this.asCodeEditorSubscription = this._pipCoreService.getAsCodeEditor()
            .subscribe((state) => {
                if (state != null && state.save) {
                    this.save();
                }
            });

        this.themeSubscription = this._theme.get().subscribe(t => {
            this.codeMirrorConfig.theme = t === 'night' ? 'darcula' : 'default';
            if (this.codemirror && this.codemirror.instance) {
                this.codemirror.instance.setOption('theme', this.codeMirrorConfig.theme);
                this._cd.markForCheck();
            }
        });
    }

    keyEvent(event: KeyboardEvent) {
        if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
            this.save();
            event.preventDefault();
        }
    }

    cancel() {
        if (this.previewMode) {
            this.store.dispatch(new ResyncPipeline({
                projectKey: this.project.key,
                pipelineName: this.pipeline.name
            })).subscribe(() => this._pipCoreService.toggleAsCodeEditor({ open: false, save: false }));
            this.previewMode = false;
            this._cd.markForCheck();
        } else {
            this._pipCoreService.toggleAsCodeEditor({ open: false, save: false });
        }
    }

    preview() {
        this.loading = true;
        this.previewMode = true;
        this.store.dispatch(new PreviewPipeline({
            projectKey: this.project.key,
            pipelineName: this.pipeline.name,
            pipCode: this.exportedPip
        })).pipe(finalize(() => {
            this.loading = false;
            this._cd.markForCheck();
        }))
            .subscribe();
    }

    save() {
        this.loading = true;
        this.store.dispatch(new ImportPipeline({
            projectKey: this.project.key,
            pipName: this.pipeline.name,
            pipelineCode: this.exportedPip
        })).pipe(finalize(() => {
            this.loading = false;
            this._cd.markForCheck();
        }))
            .subscribe(() => {
                this._pipCoreService.toggleAsCodeEditor({ open: false, save: false });
                this._pipCoreService.setPipelinePreview(null);
                this._toast.success('', this._translate.instant('pipeline_updated'));
            });
    }
}
