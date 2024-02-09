import { Component, tracked } from '@lifeart/gxt';
import { Smile } from './page-one/Smile';
import { Table } from './page-one/Table.gts';
import EuiAvatar from '@ember-eui/core/components/eui-avatar';
import EuiText from '@ember-eui/core/components/eui-text';
import EuiToolTip from '@ember-eui/core/components/eui-tool-tip';
import EuiButton from '@ember-eui/core/components/eui-button';
import EuiSpacer from '@ember-eui/core/components/eui-spacer';
import EuiTitle from '@ember-eui/core/components/eui-title';
import EuiCode from '@ember-eui/core/components/eui-code';
import EuiCallOut from '@ember-eui/core/components/eui-call-out';
import EuiBadge from '@ember-eui/core/components/eui-badge';
import EuiAccordion from '@ember-eui/core/components/eui-accordion';
import EuiPanel from '@ember-eui/core/components/eui-panel';
import EuiBottomBar from '@ember-eui/core/components/eui-bottom-bar';
import EuiFlexGroup from '@ember-eui/core/components/eui-flex-group';
import EuiFlexItem from '@ember-eui/core/components/eui-flex-item';
import EuiButtonEmpty from '@ember-eui/core/components/eui-button-empty';
import EuiPageTemplate from '@ember-eui/core/components/eui-page-template';
import EuiLoadingContent from '@ember-eui/core/components/eui-loading-content';
import EuiFlyout from '@ember-eui/core/components/eui-flyout';
import EuiFlyoutHeader from '@ember-eui/core/components/eui-flyout-header';
import EuiFlyoutBody from '@ember-eui/core/components/eui-flyout-body';
// import EuiCodeBlock from '@ember-eui/core/components/eui-code-block';

export class PageOne extends Component {
  @tracked selectedTab = true;
  @tracked showing = false;

  @tracked flyoutOpen = false;

  openFlyout = () => {
    this.flyoutOpen = true;
  };

  closeFlyout = (flyout) => {
    this.flyoutOpen = false;
  };

  get tabs() {
    console.log('get tabs', new Error().stack);
    return [
      {
        label: 'Tab 1',
        isSelected: this.selectedTab,
        onClick: this.setShowBottomBar.bind(this, true),
      },
      {
        label: 'Tab 2',
        isSelected: !this.selectedTab,
        onClick: this.setShowBottomBar.bind(this, false),
      },
    ];
  }

  setShowBottomBar = (val) => {
    this.selectedTab = val;
    this.showing = !val;
  };
  <template>
    <div class='text-white' shadowrootmode='closed'>
      <style>
        @import
        url('https://ember-eui.netlify.app/@ember-eui/themes/eui_theme_amsterdam_dark.min.css');
      </style>

      <EuiButton {{on 'click' this.openFlyout}}>
        A typical flyout
      </EuiButton>
      {{#if this.flyoutOpen}}
        <EuiFlyout @size='m' @onClose={{this.closeFlyout}}>
          <EuiFlyoutHeader @hasBorder={{true}}>
            <EuiTitle @size='l'>A typical flyout</EuiTitle>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            <EuiText>
              For consistency across the many flyouts, please utilize the
              following code for implementing the flyout with a header.
            </EuiText>

            {{!-- <EuiCodeBlock @isCopyable={{false}} @language='html'>
              Some code
            </EuiCodeBlock> --}}
          </EuiFlyoutBody>
        </EuiFlyout>
      {{/if}}

      <EuiPageTemplate
        @grow={{true}}
        @pageHeader={{hash
          iconType='logoElastic'
          pageTitle='Page Title'
          tabs=this.tabs
        }}
        @hasBottomBarBlock={{this.showing}}
      >
        <:pageSideBar>
          <EuiLoadingContent @lines={{8}} />
        </:pageSideBar>
        <:pageHeaderRightSideItems as |Item|>
          <Item>
            <EuiButton>
              Go Full Screen
            </EuiButton>
          </Item>
        </:pageHeaderRightSideItems>
        <:default>
          <EuiLoadingContent @lines={{16}} />
        </:default>
        <:bottomBar>
          Bottom bar
        </:bottomBar>
      </EuiPageTemplate>

      <EuiFlexGroup class='flex-demo'>
        <EuiFlexItem>
          <EuiButton @fill={{true}}>Buttons will widen</EuiButton>
        </EuiFlexItem>
        <EuiFlexItem>
          <div>
            <EuiButton @fill={{true}}>Unless you wrap them</EuiButton>
          </div>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiAccordion>
        <:buttonContent>
          Click me to toggle
        </:buttonContent>
        <:content>
          <EuiPanel @color='subdued' @hasShadow={{false}}>
            Any content inside of
            <strong>EuiAccordion</strong>
            will appear here.
          </EuiPanel>
        </:content>
      </EuiAccordion>

      <EuiBadge
        @iconUseSvg={{false}}
        @iconType='https://iconarchive.com/download/i103537/sensibleworld/starwars/Death-Star.ico'
        @iconSide='right'
        @color='warning'
      >
        Star Wars Lore
      </EuiBadge>
      <EuiCallOut
        @iconType='search'
        @title="Check it out, here's a really long title that will wrap within a narrower browser"
        @color='primary'
      >
        <:body>
          <p>
            Here&rsquo;s some stuff that you need to know. We can make this text
            really long so that, when viewed within a browser that&rsquo;s
            fairly narrow, it will wrap, too.
          </p>
          <p>
            And some other stuff on another line, just for kicks.

          </p>
        </:body>
      </EuiCallOut>
      <EuiText style='margin-bottom: 16px;'>
        <h4>
          🚧<span style='margin: 0px 10px 0px 10px'>{{if
              @text
              @text
              'To do'
            }}</span>🚧
        </h4>

        <EuiTitle @size='l'>
          <h1>This is a large title, only one should exist per page</h1>
        </EuiTitle>
        <EuiCode @language='js'>foo</EuiCode>

      </EuiText>

      <EuiToolTip
        @position='top'
        @content='Works on any kind of element &mdash; buttons, inputs, you name it!'
      >
        <EuiButton>Hover me</EuiButton>
      </EuiToolTip>

      <EuiSpacer />

      <EuiBottomBar>
        <EuiFlexGroup @justifyContent='spaceBetween'>
          <EuiFlexItem @grow={{false}}>
            <EuiFlexGroup @gutterSize='s'>
              <EuiFlexItem @grow={{false}}>
                <EuiButton @color='ghost' @size='s' @iconType='help'>
                  Help
                </EuiButton>
              </EuiFlexItem>
              <EuiFlexItem @grow={{false}}>
                <EuiButton @color='ghost' @size='s' @iconType='user'>
                  Add user
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
          <EuiFlexItem @grow={{false}}>
            <EuiFlexGroup @gutterSize='s'>
              <EuiFlexItem @grow={{false}}>
                <EuiButtonEmpty @color='ghost' @size='s' @iconType='cross'>
                  Discard
                </EuiButtonEmpty>
              </EuiFlexItem>
              <EuiFlexItem @grow={{false}}>
                <EuiButton
                  @color='primary'
                  @fill={{true}}
                  @size='s'
                  @iconType='check'
                >
                  Save
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiBottomBar>
    </div>
    <div class='text-white p-3'>
      <h1><q>Compilers are the New Frameworks</q> - Tom Dale &copy;</h1>
      <br />

      <div>Imagine a world where the robust, mature ecosystems of development
        tools meet the cutting-edge performance of modern compilers. That's what
        we're building here! Our platform takes the best of established
        technologies and infuses them with a new, state-of-the-art compiler.</div>
      <br />

      <div class='overflow-x-auto relative'>
        <Table />
      </div>
      <br />
      <h2>This means:</h2><br />
      <ul class='list-disc list-inside text-slate-900 dark:text-slate-200'>
        <li><b>Increased Performance:</b>
          Our modern compiler accelerates your code, making it run faster than
          ever.</li>
        <li><b>Optimized Memory Usage:</b>
          Experience more efficient memory management, allowing your
          applications to run smoother and more reliably.</li>
        <li><b>Seamless Integration:</b>
          Enjoy the ease of integrating with your favorite tools and frameworks
          from the mature ecosystem.</li>
        <li><b>Future-Proof Technology:</b>
          Stay ahead with a platform that evolves with the latest advancements
          in compiler technology.</li>

      </ul><br />
      <i>Join us in shaping the future of development, where power meets
        efficiency. Get ready to elevate your coding experience!</i>
      <br /><br />
      <a href='/pageTwo'>Go to page two <Smile /></a></div>
    <div class='w-20 h-20'>
      <EuiAvatar
        @size='l'
        @name='John Doe'
        @iconType='https://plus.unsplash.com/premium_photo-1669324357471-e33e71e3f3d8?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dXJsfGVufDB8fDB8fHww'
        @imageUrl='https://plus.unsplash.com/premium_photo-1669324357471-e33e71e3f3d8?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8dXJsfGVufDB8fDB8fHww'
      />

    </div>
  </template>
}
