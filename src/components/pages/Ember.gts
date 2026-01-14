import { Component } from '@lifeart/gxt';
// Import components directly to avoid barrel file pulling all dependencies
import EuiButton from '@ember-eui/core/components/eui-button';
import EuiCard from '@ember-eui/core/components/eui-card';
import EuiBadge from '@ember-eui/core/components/eui-badge';
import EuiCallOut from '@ember-eui/core/components/eui-call-out';
import EuiFlexGroup from '@ember-eui/core/components/eui-flex-group';
import EuiFlexItem from '@ember-eui/core/components/eui-flex-item';
import EuiText from '@ember-eui/core/components/eui-text';
import EuiTitle from '@ember-eui/core/components/eui-title';
import EuiSpacer from '@ember-eui/core/components/eui-spacer';
import EuiPanel from '@ember-eui/core/components/eui-panel';

export class Ember extends Component {
  <template>
    <div class='p-6 lg:p-8 max-w-7xl mx-auto'>
      <EuiTitle @size='l'>
        <h1>Ember EUI Components Demo</h1>
      </EuiTitle>

      <EuiSpacer @size='l' />

      <EuiCallOut
        @title='Welcome to ember-eui integration!'
        @color='success'
        @iconType='checkInCircleFilled'
      >
        <p>This page demonstrates ember-eui components running in glimmer-next with helper and modifier managers.</p>
      </EuiCallOut>

      <EuiSpacer @size='xl' />

      <EuiTitle @size='m'>
        <h2>Buttons</h2>
      </EuiTitle>

      <EuiSpacer @size='m' />

      <EuiFlexGroup @gutterSize='s' @wrap={{true}}>
        <EuiFlexItem @grow={{false}}>
          <EuiButton>Default Button</EuiButton>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiButton @fill={{true}}>Filled Button</EuiButton>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiButton @color='success'>Success</EuiButton>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiButton @color='warning'>Warning</EuiButton>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiButton @color='danger'>Danger</EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer @size='xl' />

      <EuiTitle @size='m'>
        <h2>Badges</h2>
      </EuiTitle>

      <EuiSpacer @size='m' />

      <EuiFlexGroup @gutterSize='s' @wrap={{true}}>
        <EuiFlexItem @grow={{false}}>
          <EuiBadge>Default</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiBadge @color='success'>Success</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiBadge @color='warning'>Warning</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiBadge @color='danger'>Danger</EuiBadge>
        </EuiFlexItem>
        <EuiFlexItem @grow={{false}}>
          <EuiBadge @color='#6366f1'>Custom Color</EuiBadge>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer @size='xl' />

      <EuiTitle @size='m'>
        <h2>Cards</h2>
      </EuiTitle>

      <EuiSpacer @size='m' />

      <EuiFlexGroup @gutterSize='l'>
        <EuiFlexItem>
          <EuiCard
            @title='Helper Manager'
            @description='Enables custom helper implementations with lifecycle management.'
          >
            <:footer>
              <EuiBadge @color='success'>Enabled</EuiBadge>
            </:footer>
          </EuiCard>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiCard
            @title='Modifier Manager'
            @description='Supports ember-style modifiers with proper cleanup and reactivity.'
          >
            <:footer>
              <EuiBadge @color='success'>Enabled</EuiBadge>
            </:footer>
          </EuiCard>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiCard
            @title='Ember Integration'
            @description='Full compatibility layer for ember ecosystem components.'
          >
            <:footer>
              <EuiBadge @color='success'>Enabled</EuiBadge>
            </:footer>
          </EuiCard>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer @size='xl' />

      <EuiTitle @size='m'>
        <h2>Panels</h2>
      </EuiTitle>

      <EuiSpacer @size='m' />

      <EuiPanel>
        <EuiText>
          <p>This is a basic panel component from ember-eui. Panels are used to contain and group related content with consistent styling.</p>
        </EuiText>
      </EuiPanel>

      <EuiSpacer @size='m' />

      <EuiPanel @color='subdued'>
        <EuiText>
          <p>This panel has a subdued color, useful for secondary content areas.</p>
        </EuiText>
      </EuiPanel>

      <EuiSpacer @size='xl' />

      <EuiCallOut
        @title='Implementation Details'
        @color='primary'
        @iconType='iInCircle'
      >
        <EuiText @size='s'>
          <p>The ember-eui components work through:</p>
          <ul>
            <li><strong>WITH_HELPER_MANAGER</strong> - Manages helper lifecycle</li>
            <li><strong>WITH_MODIFIER_MANAGER</strong> - Handles modifier installation and cleanup</li>
            <li><strong>WITH_EMBER_INTEGRATION</strong> - Provides Ember compatibility APIs</li>
          </ul>
        </EuiText>
      </EuiCallOut>
    </div>
  </template>
}
