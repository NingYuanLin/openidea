// CLI-only native smoke: actual NSApplication -> WKWebView -> actual input context.
// Never substitutes input method results, never fabricates DOM keyboard events.
static void selfTest(OIProbe *probe) {
    static NSUInteger smokeRuns=0;NSUInteger run=++smokeRuns;
    __weak OIProbe *weak=probe;__block NSUInteger step=0,eventIndex=0;__block BOOL busy=NO;
    double deadline=NSProcessInfo.processInfo.systemUptime+25;
    NSTimer *timer=[NSTimer timerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *timer){
        OIProbe *p=weak;
        if(!p || NSProcessInfo.processInfo.systemUptime>deadline){fprintf(stderr,"FAIL v5 smoke timeout step=%lu event=%lu\n",(unsigned long)step,(unsigned long)eventIndex);exit(20);}
        if(busy)return;
        if(step==0){
            busy=YES;[p.webview evaluateJavaScript:@"!!document.getElementById('start')" completionHandler:^(id result,NSError *error){
                if(!error && [result boolValue]){step=1;[p.webview evaluateJavaScript:@"window.confirm=()=>true;document.getElementById('ime').value='abc';document.getElementById('ime').dispatchEvent(new Event('change'));document.getElementById('privateProbe').checked=true;document.getElementById('start').click()" completionHandler:nil];}busy=NO;
            }];return;
        }
        if([p.state isEqual:@"failed"]){fprintf(stderr,"FAIL v5 readiness %s\n",p.capability.UTF8String);exit(21);}
        if(step==1 && p.ready){
            if(!p.advanced || !p.hookedClass || ![p.featureInfo[@"status"] isEqual:@"readback-confirmed"] || p.textCapabilities.count!=10){fprintf(stderr,"FAIL v5 capability\n");exit(22);}
            step=2;
        }
        if(step==2){
            NSUInteger dom=0;for(NSDictionary *r in p.rows)if([r[@"source"] isEqual:@"dom-window-capture"] && [r[@"trusted"] boolValue])dom++;
            if(dom<eventIndex || [p pending])return;
            if(eventIndex<8){
                BOOL down=eventIndex%2==0;NSUInteger side=(eventIndex/2)%2==0?56:60;
                NSEvent *event=[NSEvent keyEventWithType:NSEventTypeFlagsChanged location:NSZeroPoint modifierFlags:down?NSEventModifierFlagShift:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:p.webview.window.windowNumber context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:NO keyCode:side];
                eventIndex++;[NSApp postEvent:event atStart:NO];return;
            }
            if(dom!=8 || p.calls.count!=8){fprintf(stderr,"FAIL v5 native/DOM counts\n");exit(23);}
            for(NSNumber *count in p.calls.allValues)if(count.unsignedIntegerValue!=1){fprintf(stderr,"FAIL v5 duplicate callback\n");exit(24);}
            NSData *data=[NSJSONSerialization dataWithJSONObject:[p snapshot] options:0 error:nil];
            printf("REAL_WK_SMOKE %s\n",[[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding] UTF8String]);fflush(stdout);
            [p stop];step=3;return;
        }
        if(step==3){
            if(p.hookedClass || p.readinessTimer || p.monitor){fprintf(stderr,"FAIL stop cleanup\n");exit(25);}
            [p.webview evaluateJavaScript:@"document.getElementById('privateProbe').checked=false;document.getElementById('start').click()" completionHandler:nil];step=4;return;
        }
        if(step==4 && p.ready){
            if(p.advanced || p.hookedClass || p.calls.count || p.textCalls.count){fprintf(stderr,"FAIL baseline isolation\n");exit(26);}
            [p export];step=5;return;
        }
        if(step==5 && p.webview.window.attachedSheet){[NSApp endSheet:p.webview.window.attachedSheet returnCode:NSModalResponseCancel];step=6;return;}
        if(step==6 && !p.webview.window.attachedSheet){
            if(p.active || p.monitor || p.readinessTimer){fprintf(stderr,"FAIL export cancel\n");exit(27);}
            [p.webview evaluateJavaScript:@"document.getElementById('start').click()" completionHandler:nil];step=7;return;
        }
        if(step==7 && p.ready){
            step=8;
            if(run==1 && p.changeMode){
                [timer invalidate];NSString *next=[p.featureInfo[@"requested"] isEqual:@"on"]?@"off":@"on";
                p.changeMode(next);return;
            }
            p.selfTestAwaitingClose=YES;[p.webview.window performClose:nil];
        }
    }];[NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}
